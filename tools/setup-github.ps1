<#
  Weltenschmiede – einmalige Einrichtung auf GitHub Pages
  --------------------------------------------------------
  Aufruf im Projektordner (PowerShell):
      powershell -ExecutionPolicy Bypass -File tools\setup-github.ps1
  Optional anderer Repository-Name:
      powershell -ExecutionPolicy Bypass -File tools\setup-github.ps1 -RepoName meine-weltenschmiede

  Was passiert:
    1. GitHub CLI (gh) wird bei Bedarf per winget installiert
    2. Anmeldung bei GitHub im Browser (einmalig)
    3. Git-Repository anlegen, alles committen
    4. Öffentliches Repository auf GitHub erstellen und hochladen
    5. GitHub Pages aktivieren  →  https://<dein-name>.github.io/<RepoName>/
  Hinweis: Kostenlose GitHub Pages brauchen ein öffentliches Repository. Der Code enthält
  keine Geheimnisse – KI-Schlüssel bleiben in deinem Browser, deine Daten in deiner Firebase.
#>
param([string]$RepoName = "weltenschmiede")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

Step "Prüfe Git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git fehlt. Installieren mit:  winget install --id Git.Git -e   (danach PowerShell neu öffnen)"
}

Step "Prüfe GitHub CLI (gh)"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "GitHub CLI wird installiert (winget) …"
  winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "gh wurde installiert, ist aber noch nicht im PATH. Bitte PowerShell neu öffnen und das Skript erneut starten."
  }
}

Step "Prüfe die App vor dem Hochladen"
node tools/check-imports.mjs
if ($LASTEXITCODE -ne 0) { throw "Import-Prüfung fehlgeschlagen – bitte zuerst beheben." }

Step "GitHub-Anmeldung"
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { gh auth login --hostname github.com --git-protocol https --web }
$login = (gh api user --jq .login).Trim()
Write-Host "Angemeldet als $login"

Step "Git-Repository vorbereiten"
if (-not (Test-Path .git)) { git init -b main | Out-Null }
$gitName = git config user.name
if (-not $gitName) { git config user.name $login }
$gitMail = git config user.email
if (-not $gitMail) {
  $id = (gh api user --jq .id).Trim()
  git config user.email "$id+$login@users.noreply.github.com"
}
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "Weltenschmiede: erste Version" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" | Out-Null
}

Step "Repository $login/$RepoName auf GitHub"
gh repo view "$login/$RepoName" *> $null
if ($LASTEXITCODE -ne 0) {
  gh repo create $RepoName --public --source . --remote origin --push --description "Weltenschmiede – D&D-5e-Kampagnen-Werkstatt"
} else {
  git remote get-url origin *> $null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$login/$RepoName.git" }
  git push -u origin main
}

Step "GitHub Pages aktivieren"
gh api -X POST "repos/$login/$RepoName/pages" -f "source[branch]=main" -f "source[path]=/" *> $null
if ($LASTEXITCODE -ne 0) {
  gh api -X PUT "repos/$login/$RepoName/pages" -f "source[branch]=main" -f "source[path]=/" *> $null
}

$url = "https://$login.github.io/$RepoName/"
Write-Host "`nFertig! In 1–2 Minuten erreichbar unter:" -ForegroundColor Green
Write-Host "   $url`n" -ForegroundColor Green
Write-Host "Nächste Schritte (siehe README.md):"
Write-Host "  1. Adresse auf Handy/Tablet öffnen und 'Zum Startbildschirm hinzufügen'"
Write-Host "  2. Einstellungen → KI & Modelle: API-Schlüssel eintragen"
Write-Host "  3. Optional: Cloud (Firebase) einrichten und Domain $login.github.io dort freigeben"
Start-Process $url
