# Automated MSIX Packaging Script for Campus Connect
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "=== Step 1: Locating Windows SDK Tools ===" -ForegroundColor Cyan
$makeAppx = (Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1).FullName
if (-not $makeAppx) {
    throw "MakeAppx.exe not found. Ensure Windows 10/11 SDK is installed."
}
Write-Host "Using MakeAppx: $makeAppx"

$signTool = (Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1).FullName
Write-Host "Using SignTool: $signTool"

Write-Host "=== Step 2: Preparing MSIX Package Directory ===" -ForegroundColor Cyan
$packageDir = Join-Path $scriptDir "msix_package"
if (Test-Path $packageDir) { Remove-Item $packageDir -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $packageDir "Assets") -Force | Out-Null

$exeSource = Join-Path $scriptDir "campus-connect.exe"
if (-not (Test-Path $exeSource)) {
    throw "campus-connect.exe not found at $exeSource. Compile it first."
}
Copy-Item $exeSource (Join-Path $packageDir "campus-connect.exe")

Write-Host "=== Step 3: Generating Visual Assets ===" -ForegroundColor Cyan
Add-Type -AssemblyName System.Drawing

$sourceIcon = Join-Path $scriptDir "..\mobile\assets\icon.png"
if (-not (Test-Path $sourceIcon)) {
    $sourceIcon = Join-Path $scriptDir "..\favicon.png"
}

function Resize-Image($srcPath, $destPath, $width, $height) {
    $srcImg = [System.Drawing.Image]::FromFile($srcPath)
    $destBmp = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($destBmp)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($srcImg, 0, 0, $width, $height)
    $destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $destBmp.Dispose()
    $srcImg.Dispose()
}

$assetsDir = Join-Path $packageDir "Assets"
Resize-Image $sourceIcon (Join-Path $assetsDir "StoreLogo.png") 50 50
Resize-Image $sourceIcon (Join-Path $assetsDir "Square150x150Logo.png") 150 150
Resize-Image $sourceIcon (Join-Path $assetsDir "Square44x44Logo.png") 44 44

Write-Host "=== Step 4: Generating AppxManifest.xml ===" -ForegroundColor Cyan
$manifestContent = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="CURAJ.CampusConnect"
    Publisher="CN=CampusConnect"
    Version="1.0.0.0"
    ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>Campus Connect</DisplayName>
    <PublisherDisplayName>Nitin Yadav</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
    <Description>Automated 1-click Wi-Fi auto-login utility for Central University of Rajasthan (CURAJ).</Description>
  </Properties>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>

  <Applications>
    <Application Id="App"
      Executable="campus-connect.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Campus Connect"
        Description="CURAJ Wi-Fi Auto-Login"
        BackgroundColor="#1c1917"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile ShortName="Campus Connect" />
        <uap:SplashScreen BackgroundColor="#1c1917" Image="Assets\Square150x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
</Package>
"@
Set-Content -Path (Join-Path $packageDir "AppxManifest.xml") -Value $manifestContent -Encoding UTF8

Write-Host "=== Step 5: Packaging MSIX ===" -ForegroundColor Cyan
$msixOutput = Join-Path $scriptDir "campus-connect.msix"
if (Test-Path $msixOutput) { Remove-Item $msixOutput -Force }

& $makeAppx pack /d $packageDir /p $msixOutput /nv /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE" }

Write-Host "=== Step 6: Code Signing MSIX Package ===" -ForegroundColor Cyan
if ($signTool) {
    $pfxPath = Join-Path $scriptDir "campusconnect.pfx"
    $certPassword = ConvertTo-SecureString -String "!t$meKEYSTOREBC69" -Force -AsPlainText

    $cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=CampusConnect" } | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type Custom -Subject "CN=CampusConnect" `
            -KeyUsage DigitalSignature `
            -FriendlyName "Campus Connect Code Signing" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
    }

    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $certPassword -Force | Out-Null

    & $signTool sign /fd SHA256 /a /f $pfxPath /p "!t$meKEYSTOREBC69" $msixOutput
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "SignTool exited with code $LASTEXITCODE. Unsigned package still valid for Store ingestion."
    } else {
        Write-Host "MSIX successfully signed." -ForegroundColor Green
    }
}

# Cleanup temporary staging folder
if (Test-Path $packageDir) { Remove-Item $packageDir -Recurse -Force }

Write-Host "=== MSIX Build Finished: $msixOutput ===" -ForegroundColor Green
Get-Item $msixOutput | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
