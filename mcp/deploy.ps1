<#
  Weltenschmiede – MCP-Server bei Cloudflare veröffentlichen
  ----------------------------------------------------------
  Aufruf im Projektordner:
      powershell -ExecutionPolicy Bypass -File mcp\deploy.ps1

  Beim ersten Mal öffnet sich der Browser für die Cloudflare-Anmeldung (kostenloses Konto genügt).
  Das Schlüssel-Geheimnis SEAL_SECRET wird einmalig zufällig erzeugt und nur bei Cloudflare gespeichert.
#>
$ErrorActionPreference = "Continue"  # Wrangler schreibt Hinweise nach stderr; Fehler über $LASTEXITCODE
Set-Location $PSScriptRoot

$who = (npx --yes wrangler@4 whoami 2>&1) -join "`n"
if ($who -match "not authenticated") {
  Write-Host "Cloudflare-Anmeldung im Browser …" -ForegroundColor Yellow
  npx wrangler@4 login
  if ($LASTEXITCODE -ne 0) { throw "Anmeldung abgebrochen." }
}

$secrets = (npx wrangler@4 secret list 2>&1) -join "`n"
if ($secrets -notmatch "SEAL_SECRET") {
  Write-Host "Erzeuge SEAL_SECRET …" -ForegroundColor Yellow
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  $secret | npx wrangler@4 secret put SEAL_SECRET
  if ($LASTEXITCODE -ne 0) { throw "SEAL_SECRET konnte nicht gesetzt werden." }
}

$out = (npx wrangler@4 deploy 2>&1) -join "`n"
Write-Host $out
if ($LASTEXITCODE -ne 0) { throw "Veröffentlichen fehlgeschlagen." }
$url = [regex]::Match($out, 'https://[a-z0-9.-]+\.workers\.dev').Value
if ($url) {
  Write-Host ""
  Write-Host "Fertig! In Claude → Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen:" -ForegroundColor Green
  Write-Host "  Name:           Weltenschmiede" -ForegroundColor Green
  Write-Host "  MCP-Server-URL: $url/mcp" -ForegroundColor Green
}
