# Studio office control. Usage: studio.ps1 <start|ceo|head|status|stop|lock|unlock> [name]
#   start        launch the office server (port 3100) and open it in an app window
#   ceo          launch the CEO session with STUDIO_PROMPT.md
#   head <name>  launch one Head in its worktree: gameplay art ui qa levels design
#   status       list running agents
#   stop <id>    stop one agent by id
#   lock/unlock  create/remove the budget lock (blocks all launches)
param([Parameter(Mandatory)][string]$Cmd, [string]$Name)
$ErrorActionPreference = 'Stop'
$Port  = 3100
$Build = if ($env:PA_BUILD) { $env:PA_BUILD } else { 'C:\Users\huey2\pa-studio' }
$Base  = "http://127.0.0.1:$Port"
$TokenFile = Join-Path $HOME '.pixel-agents\standalone-token'
$LockFile  = Join-Path $HOME '.pixel-agents\studio-budget.lock'
$Studio = 'Y:\PRojects\StreetHockey'
$Heads = @{
  gameplay = 'C:\Users\huey2\sh_g62';  art    = 'C:\Users\huey2\sh_art2'
  ui       = 'C:\Users\huey2\sh_ui2';  qa     = 'C:\Users\huey2\sh_qa2'
  levels   = 'C:\Users\huey2\sh_lv2';  design = 'Y:\PRojects\StreetHockey_wt\design-t60'
}

function Test-Up { try { (Invoke-RestMethod "$Base/api/health" -TimeoutSec 2).status -eq 'ok' } catch { $false } }
function Get-Auth { @{ Authorization = 'Bearer ' + (Get-Content $TokenFile -Raw).Trim() } }
function Post-Agent($body) {
  Invoke-RestMethod "$Base/api/agents" -Method Post -Headers (Get-Auth) -ContentType 'application/json' -Body ($body | ConvertTo-Json)
}

switch ($Cmd) {
  'start' {
    if (-not (Test-Up)) {
      Start-Process node -ArgumentList 'dist/cli.js', '--port', $Port -WorkingDirectory $Build -WindowStyle Hidden
      1..30 | ForEach-Object { if (-not (Test-Up)) { Start-Sleep -Milliseconds 500 } }
      if (-not (Test-Up)) { throw "office server did not start (build at $Build)" }
    }
    $url = "$Base/?token=" + (Get-Content $TokenFile -Raw).Trim()
    $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    Start-Process $edge "--app=$url"
  }
  'ceo' {
    Post-Agent @{ directory = $Studio; promptFile = "$Studio\STUDIO_PROMPT.md" }
  }
  'head' {
    if (-not $Heads.ContainsKey($Name)) { throw "unknown head '$Name' (use: $($Heads.Keys -join ', '))" }
    Post-Agent @{ directory = $Heads[$Name]; prompt = "You are the Head of $Name for Rinkside Interactive. Work only in this worktree, check your work, and report to the CEO." }
  }
  'status' { Invoke-RestMethod "$Base/api/agents" -Headers (Get-Auth) | Format-Table }
  'stop'   { Invoke-RestMethod "$Base/api/agents/$Name" -Method Delete -Headers (Get-Auth) }
  'lock'   { New-Item -ItemType File -Force $LockFile | Out-Null; 'locked' }
  'unlock' { Remove-Item $LockFile -ErrorAction SilentlyContinue; 'unlocked' }
  default  { throw "unknown command '$Cmd'" }
}
