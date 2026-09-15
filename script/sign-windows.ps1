param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

# 用 Continue 而不是 Stop:任何签名/证书相关异常都转 warning,绝不 throw,
# 避免 electron-builder 把单文件签名失败升级成整个 build 失败(用户连 setup.exe 都拿不到)
$ErrorActionPreference = "Continue"

if (-not $Path -or $Path.Count -eq 0) {
  Write-Warning "No paths provided to sign-windows.ps1, nothing to sign"
  exit 0
}

if ($env:GITHUB_ACTIONS -ne "true") {
  Write-Host "Skipping Windows signing because this is not running on GitHub Actions"
  exit 0
}

$vars = @{
  endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
  account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
  profile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
}

$files = @($Path | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty Path -Unique)

if (-not $files -or $files.Count -eq 0) {
  throw "No files matched the requested paths"
}

# 1) 首选 Azure Trusted Signing(Azure 上买证书后填这几个 Secret)
if ($vars.Values | Where-Object { -not $_ }) {
  Write-Host "Azure Trusted Signing not configured, will fall back to self-signed"
} else {
  $moduleVersion = "0.5.8"
  $module = Get-Module -ListAvailable -Name TrustedSigning | Where-Object { $_.Version -eq [version] $moduleVersion }

  if (-not $module) {
    try {
      Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
    }
    catch {
      Write-Host "NuGet package provider install skipped: $($_.Exception.Message)"
    }

    Install-Module -Name TrustedSigning -RequiredVersion $moduleVersion -Force -Repository PSGallery -Scope CurrentUser
  }

  Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force

  $params = @{
    Endpoint                         = $vars.endpoint
    CodeSigningAccountName           = $vars.account
    CertificateProfileName           = $vars.profile
    Files                            = ($files -join ",")
    FileDigest                       = "SHA256"
    TimestampDigest                  = "SHA256"
    TimestampRfc3161                 = "http://timestamp.acs.microsoft.com"
    ExcludeEnvironmentCredential     = $true
    ExcludeWorkloadIdentityCredential = $true
    ExcludeManagedIdentityCredential = $true
    ExcludeSharedTokenCacheCredential = $true
    ExcludeVisualStudioCredential    = $true
    ExcludeVisualStudioCodeCredential = $true
    ExcludeAzureCliCredential        = $false
    ExcludeAzurePowerShellCredential = $true
    ExcludeAzureDeveloperCliCredential = $true
    ExcludeInteractiveBrowserCredential = $true
  }

  Invoke-TrustedSigning @params
  Write-Host "Azure Trusted Signing complete"
  exit 0
}

# 2) Fallback: 用自签证书 + RFC3161 时间戳签名。
#    为什么必须签名:未签名的 Electron exe 在 Windows Defender / SmartScreen 下几乎
#    100% 会被当作可疑文件隔离(NovaWay.exe 会被 Defender 主动删除,留下卸载器、
#    pak、icudtl.dat 等白名单文件 —— 用户看到的"装完打不开"就是这个现象)。
#    即便自签证书不在用户机器的信任链里,有签名 + 时间戳也能让 Defender 走启发式
#    而不是直接 quarantine,误报率显著下降。
$certSubject = "CN=NovaWay Desktop"
$timestampServer = "http://timestamp.digicert.com"

try {
  $cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert |
    Where-Object { $_.Subject -eq $certSubject } |
    Select-Object -First 1

  if (-not $cert) {
    Write-Host "Generating self-signed code signing certificate: $certSubject"
    $cert = New-SelfSignedCertificate `
      -Subject $certSubject `
      -Type CodeSigningCert `
      -CertStoreLocation "Cert:\CurrentUser\My" `
      -NotAfter (Get-Date).AddYears(5) `
      -KeyUsage DigitalSignature `
      -KeyAlgorithm RSA `
      -KeyLength 2048 `
      -KeyExportPolicy NonExportable
  }

  $exitCode = 0
  foreach ($f in $files) {
    Write-Host "Self-signing: $f"
    try {
      $sig = Set-AuthenticodeSignature `
        -FilePath $f `
        -Certificate $cert `
        -TimestampServer $timestampServer `
        -HashAlgorithm SHA256

      if ($sig.Status -ne "Valid") {
        Write-Warning "Signature status for ${f}: $($sig.Status) - $($sig.StatusMessage)"
        $exitCode = 1
      } else {
        Write-Host "  -> Signed ($($sig.SignerCertificate.Subject))"
      }
    } catch {
      Write-Warning "Set-AuthenticodeSignature threw for ${f}: $($_.Exception.Message)"
      $exitCode = 1
    }
  }

  if ($exitCode -ne 0) {
    # 关键: 签名部分失败(证书创建失败 / 时间戳服务器不通 / 文件被锁)也不能
    # 让 electron-builder fail 整个 build —— 否则 Release 啥都拿不到。
    # 把 exit code 强制清零,错误信息已经打到 stderr,warning 状态。
    Write-Warning "One or more files failed to sign — uploading unsigned installer"
    Write-Warning "Windows Defender may quarantine NovaWay.exe on user machines"
    Write-Warning "Consider setting AZURE_TRUSTED_SIGNING_* secrets for production releases"
    $exitCode = 0
  }

  Write-Host "Self-signed fallback signing complete (timestamp: $timestampServer)"
  exit $exitCode
} catch {
  Write-Warning "Self-signed fallback failed: $($_.Exception.Message)"
  Write-Warning "Unsigned binary will be uploaded — Windows Defender may quarantine it on user machines"
  exit 0
}
