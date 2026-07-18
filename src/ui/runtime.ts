export function openDashboard(hash = ''): void {
  const dashboardUrl = chrome.runtime.getURL(`/dashboard.html${hash}`);
  window.open(dashboardUrl, '_blank', 'noopener,noreferrer');
}

export function downloadJson(value: unknown, filename: string): void {
  const content = JSON.stringify(value, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
