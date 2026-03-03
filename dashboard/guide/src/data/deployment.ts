export interface DeployPhase {
  number: number;
  label: string;
  description: string;
  icon: string;
  duration: string;
}

export interface Prerequisite {
  label: string;
  description: string;
}

export const prerequisites: Prerequisite[] = [
  { label: 'Windows Server 2019+', description: 'Or Windows 11 workstation. 2-4 cores, 8 GB RAM, 60-100 GB storage.' },
  { label: 'Network access', description: 'Must reach on-prem SQL servers directly. No VPN hop = faster extractions.' },
  { label: 'Admin rights', description: 'Script self-elevates if not already running as Administrator.' },
  { label: 'Fabric SP credentials', description: 'Service Principal client secret for Fabric API access.' },
];

export const phases: DeployPhase[] = [
  { number: 1, label: 'Package Manager', description: 'Installs Chocolatey for automated package management.', icon: 'Package', duration: '~30s' },
  { number: 2, label: 'Core Tools', description: 'Git, Node.js 22 LTS, Python 3.12, NSSM service manager.', icon: 'Wrench', duration: '~2 min' },
  { number: 3, label: 'Chrome', description: 'Google Chrome for dashboard access.', icon: 'Globe', duration: '~30s' },
  { number: 4, label: 'ODBC Driver 18', description: 'SQL Server driver for direct on-prem database connections.', icon: 'Database', duration: '~15s' },
  { number: 5, label: 'Python Dependencies', description: 'pyodbc, polars, azure-storage-file-datalake, plus engine requirements.', icon: 'Box', duration: '~30s' },
  { number: 6, label: 'CLI Tools', description: 'Development and orchestration CLI tools.', icon: 'Terminal', duration: '~1 min' },
  { number: 7, label: 'Desktop Applications', description: 'Desktop apps for local AI-assisted development.', icon: 'Monitor', duration: '~2 min' },
  { number: 8, label: 'Project Directories', description: 'Creates project root and workspace structure.', icon: 'FolderTree', duration: '~5s' },
  { number: 9, label: 'Clone Repositories', description: 'Clones FMD Framework and session bridge from GitHub.', icon: 'GitBranch', duration: '~30s' },
  { number: 10, label: 'npm Install', description: 'Installs Node.js dependencies for dashboard and session bridge.', icon: 'Download', duration: '~1 min' },
  { number: 11, label: 'Build Artifacts', description: 'Compiles React dashboard and session bridge for production.', icon: 'Hammer', duration: '~30s' },
  { number: 12, label: 'Deploy Config Bundle', description: 'Copies configuration files with path substitution for target machine.', icon: 'FileJson', duration: '~5s' },
  { number: 13, label: 'Dashboard API Config', description: 'Deploys server config with Fabric credentials and endpoint URLs.', icon: 'Settings', duration: '~5s' },
  { number: 14, label: 'Windows Services', description: 'Registers dashboard + session bridge as NSSM services with auto-restart.', icon: 'Server', duration: '~15s' },
  { number: 15, label: 'Firewall Rules', description: 'Opens dashboard port and session bridge port for local network access.', icon: 'Shield', duration: '~5s' },
  { number: 16, label: 'IIS Reverse Proxy', description: 'Sets up IIS with URL Rewrite, ARR, and Windows Authentication.', icon: 'Lock', duration: '~2 min' },
  { number: 17, label: 'Verification', description: 'Tests all services, connections, builds, and endpoints. Reports pass/fail.', icon: 'CheckCircle2', duration: '~15s' },
];

export const highlights = [
  { label: 'Fully Idempotent', description: 'Every phase checks before acting. Safe to re-run at any time.' },
  { label: 'Single Script', description: 'One PowerShell script. Zero manual steps. Clone and go.' },
  { label: 'Auto-Elevate', description: 'Detects if running as admin. Self-relaunches elevated if not.' },
  { label: 'State Persistence', description: 'If any phase fails, fix the issue and re-run. Picks up where it left off.' },
  { label: 'Config Bundle', description: 'All configs exported from source machine, path-substituted at deploy time.' },
  { label: 'Windows Auth via IIS', description: 'End users authenticate with their Windows credentials. No login page needed.' },
];
