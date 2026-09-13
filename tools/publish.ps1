<#
  Weltenschmiede – Änderungen veröffentlichen
  -------------------------------------------
  Aufruf im Projektordner:
      powershell -ExecutionPolicy Bypass -File tools\publish.ps1 -Message "Neue Karten-Funktion"

  Prüft die Module, aktualisiert Dateiliste + Cache-Version im Service Worker (damit alle Geräte
  die neue Version laden und offline vollständig funktionieren), committet und pusht zu GitHub.
#>
param([string]$Message = "Aktualisierung")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

node tools/check-imports.mjs
if ($LASTEXITCODE -ne 0) { throw "Import-Prüfung fehlgeschlagen – bitte zuerst beheben." }

$files = @('./', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg')
$files += Get-ChildItem js -Recurse -Filter *.js | Sort-Object FullName | ForEach-Object {
  './' + (Resolve-Path -Relative $_.FullName).Substring(2).Replace('\', '/')
}
$list = ($files | ForEach-Object { "  '$_'," }) -join "`n"
$sw = [IO.File]::ReadAllText((Resolve-Path sw.js))
$sw = [regex]::Replace($sw, '(?s)// @@FILES-START@@.*?// @@FILES-END@@', "// @@FILES-START@@`nconst SHELL = [`n$list`n];`n// @@FILES-END@@")
$stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$sw = [regex]::Replace($sw, "const VERSION = '[^']*';", "const VERSION = 'ws-$stamp';")
[IO.File]::WriteAllText((Resolve-Path sw.js), $sw, (New-Object System.Text.UTF8Encoding $false))

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host "Keine Änderungen zu veröffentlichen."; exit 0 }
git commit -m $Message | Out-Null
git push
Write-Host "Veröffentlicht (Version ws-$stamp). GitHub Pages ist in ~1 Minute aktualisiert." -ForegroundColor Green
