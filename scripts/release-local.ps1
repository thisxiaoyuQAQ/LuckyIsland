[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$Tag,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([Parameter(Mandatory = $true)][scriptblock]$Command)
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE"
    }
}

if ($env:OS -ne 'Windows_NT') {
    throw 'Local release fallback only supports Windows.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    $branch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
        throw "Release requires branch main; current branch is '$branch'."
    }

    $dirty = git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect git status.' }
    if ($dirty) { throw 'Release requires a clean working tree.' }

    Invoke-Checked { git rev-parse --verify "refs/tags/$Tag" }
    $tagCommit = (git rev-list -n 1 $Tag).Trim()
    $headCommit = (git rev-parse HEAD).Trim()
    if ($tagCommit -ne $headCommit) {
        throw "Tag $Tag does not point at HEAD."
    }

    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
        throw 'TAURI_SIGNING_PRIVATE_KEY is required.'
    }
    if ([string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
        throw 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required.'
    }

    Invoke-Checked { pnpm release:check-version -- --tag $Tag }
    $version = (node -p "require('./package.json').version").Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read package version.' }

    Invoke-Checked { pnpm test }
    Invoke-Checked { pnpm exec tsc --noEmit }
    Invoke-Checked { pnpm build }
    Invoke-Checked { cargo test --manifest-path src-tauri/Cargo.toml --lib --locked }
    Invoke-Checked { pnpm tauri build -- --target x86_64-pc-windows-msvc }

    $bundleDir = Join-Path $repoRoot 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
    if (-not (Test-Path $bundleDir)) {
        $bundleDir = Join-Path $repoRoot 'src-tauri/target/release/bundle/nsis'
    }
    $installer = Get-ChildItem $bundleDir -File -Filter '*.exe' | Select-Object -First 1
    if (-not $installer) { throw 'Built NSIS installer was not found.' }
    $signaturePath = "$($installer.FullName).sig"
    if (-not (Test-Path $signaturePath)) { throw 'Built updater signature was not found.' }

    $assetDir = Join-Path $repoRoot '.release-assets'
    if (Test-Path $assetDir) { Remove-Item $assetDir -Recurse -Force }
    New-Item -ItemType Directory -Path $assetDir | Out-Null
    Copy-Item $installer.FullName $assetDir
    Copy-Item $signaturePath $assetDir
    $manifestPath = Join-Path $assetDir 'latest.json'
    Invoke-Checked {
        node scripts/generate-updater-manifest.mjs --version $version --tag $Tag `
            --filename $installer.Name --signature-file $signaturePath --output $manifestPath
    }
    Invoke-Checked {
        pnpm release:validate-assets -- --dir $assetDir --version $version --tag $Tag
    }

    $existingRelease = gh release view $Tag --json id 2>$null
    if ($LASTEXITCODE -eq 0 -or $existingRelease) {
        throw "GitHub Release $Tag already exists; refusing to overwrite it."
    }

    $assetPaths = @(
        (Join-Path $assetDir $installer.Name),
        (Join-Path $assetDir "$($installer.Name).sig"),
        $manifestPath
    )
    Write-Host "Dry-run validated. Intended command: gh release create $Tag --draft --title 'LuckyIsland $Tag' <assets>"

    if ($Publish) {
        Invoke-Checked { gh release create $Tag @assetPaths --draft --title "LuckyIsland $Tag" --generate-notes }
        $downloadDir = Join-Path $repoRoot '.release-download'
        if (Test-Path $downloadDir) { Remove-Item $downloadDir -Recurse -Force }
        New-Item -ItemType Directory -Path $downloadDir | Out-Null
        Invoke-Checked { gh release download $Tag --dir $downloadDir }
        $metadataPath = Join-Path $downloadDir 'release-metadata.json'
        Invoke-Checked { gh api "repos/thisxiaoyuQAQ/LuckyIsland/releases/tags/$Tag" | Out-File -Encoding utf8 $metadataPath }
        Invoke-Checked {
            pnpm release:validate-assets -- --dir $downloadDir --version $version --tag $Tag `
                --release-metadata $metadataPath --expected-draft true
        }
        Invoke-Checked { gh release edit $Tag --draft=false --latest }
        Invoke-Checked { gh api "repos/thisxiaoyuQAQ/LuckyIsland/releases/tags/$Tag" | Out-File -Encoding utf8 $metadataPath }
        Invoke-Checked {
            pnpm release:validate-assets -- --dir $downloadDir --version $version --tag $Tag `
                --release-metadata $metadataPath --expected-draft false
        }
    }
}
finally {
    Pop-Location
}
