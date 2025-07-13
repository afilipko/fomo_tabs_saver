// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const exportCurrentBtn = document.getElementById('exportCurrentWindow');
  const exportAllBtn = document.getElementById('exportAllWindows');
  const viewSavedBtn = document.getElementById('viewSavedExports');
  const resetBtn = document.getElementById('resetData');
  const statusDiv = document.getElementById('status');

  exportCurrentBtn.addEventListener('click', () => exportTabs(false));
  exportAllBtn.addEventListener('click', () => exportTabs(true));
  viewSavedBtn.addEventListener('click', showSavedExports);
  resetBtn.addEventListener('click', resetAllData);


  function getDownloadFile() {
    const checkbox = document.getElementById('downloadFile');
    return checkbox ? checkbox.checked : false;
  }

  function filterTabs(tabs) {
    const seen = new Set();
    const authPatterns = [
      /login/i,
      /signin/i,
      /auth/i,
      /oauth/i,
      /sso/i,
      /authenticate/i,
      /register/i,
      /signup/i,
      /password/i,
      /forgot/i,
      /reset/i,
      /verify/i,
      /confirm/i,
      /2fa/i,
      /mfa/i
    ];

    const filtered = tabs.filter(tab => {
      // Skip if URL is duplicate
      if (seen.has(tab.url)) {
        return false;
      }
      seen.add(tab.url);

      const url = tab.url.toLowerCase();
      const title = tab.title.toLowerCase();

      // Skip chrome:// and chrome-extension:// URLs
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        return false;
      }

      // Skip Google search URLs and Stack Overflow
      if (url.includes('google.com/search') || url.includes('stackoverflow.com')) {
        return false;
      }

      // Skip if URL matches auth/login patterns
      for (const pattern of authPatterns) {
        if (pattern.test(url) || pattern.test(title)) {
          return false;
        }
      }

      // Skip common auth domains
      const authDomains = [
        'accounts.google.com',
        'login.microsoftonline.com',
        'auth.openai.com',
        'github.com/login',
        'twitter.com/login',
        'facebook.com/login',
        'linkedin.com/login'
      ];

      for (const domain of authDomains) {
        if (url.includes(domain)) {
          return false;
        }
      }

      return true;
    });

    return {
      filtered: filtered,
      originalCount: tabs.length,
      filteredCount: filtered.length,
      duplicatesRemoved: tabs.length - seen.size,
      authPagesRemoved: seen.size - filtered.length
    };
  }

  function formatTabs(tabs) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    
    const jsonData = {
      exportDate: new Date().toISOString(),
      tabs: tabs.map(tab => ({
        title: tab.title,
        url: tab.url,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        pinned: tab.pinned,
        contentTags: tab.contentTags || null
      }))
    };
    return {
      content: JSON.stringify(jsonData, null, 2),
      filename: `fomo-tabs-${timestamp}.json`
    };
  }

  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${isError ? 'error' : 'success'}`;
    statusDiv.style.display = 'block';

    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }

  async function exportTabs(allWindows) {
    try {
      const queryOptions = allWindows ? {} : { currentWindow: true };

      chrome.tabs.query(queryOptions, async (tabs) => {
        if (chrome.runtime.lastError) {
          showStatus(`Error: ${chrome.runtime.lastError.message}`, true);
          return;
        }

        if (tabs.length === 0) {
          showStatus('No tabs found', true);
          return;
        }

        const downloadFile = getDownloadFile();

        // Filter tabs to remove duplicates and auth pages
        const filterResult = filterTabs(tabs);
        const filteredTabs = filterResult.filtered;

        // Show filtering results
        if (filterResult.originalCount !== filterResult.filteredCount) {
          showStatus(`Filtered: ${filterResult.originalCount} → ${filterResult.filteredCount} tabs (removed ${filterResult.duplicatesRemoved} duplicates, ${filterResult.authPagesRemoved} auth pages)`);
        }

        try {
          // Add content tags if possible
          let tabsToExport = filteredTabs;
          try {
            showStatus('Adding content tags...');
            tabsToExport = await contentTagger.tagMultipleUrls(filteredTabs);
            showStatus('Content tagging completed');
          } catch (tagError) {
            console.warn('Content tagging failed, proceeding without tags:', tagError);
            showStatus('Proceeding without content tags');
          }

          // Always save to IndexedDB
          const results = await tabStorage.saveUrls(tabsToExport, { append: true });
          
          // Download file if requested
          if (downloadFile) {
            const { content, filename } = formatTabs(tabsToExport);
            const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            chrome.downloads.download({
              url: url,
              filename: filename,
              saveAs: true
            }, () => {
              if (chrome.runtime.lastError) {
                showStatus(`Download failed: ${chrome.runtime.lastError.message}`, true);
              } else {
                showStatus(`Saved ${results.saved} new URLs, updated ${results.updated} existing (${results.errors.length} errors) & downloaded file`);
              }

              // Clean up the blob URL
              URL.revokeObjectURL(url);
            });
          } else {
            showStatus(`Saved ${results.saved} new URLs, updated ${results.updated} existing (${results.errors.length} errors)`);
          }
        } catch (dbError) {
          showStatus(`Database error: ${dbError.message}`, true);
        }
      });
    } catch (error) {
      showStatus(`Error: ${error.message}`, true);
    }
  }

  async function showSavedExports() {
    try {
      // Open tab-viewer in a new tab that reads from IndexedDB
      chrome.tabs.create({
        url: chrome.runtime.getURL('tab-viewer.html')
      });
    } catch (error) {
      showStatus(`Error opening tab viewer: ${error.message}`, true);
    }
  }

  async function resetAllData() {
    // Show confirmation dialog
    const confirmed = confirm(
      'Are you sure you want to reset all saved data?\n\n' +
      'This will permanently delete all saved URLs and cannot be undone.\n\n' +
      'Click OK to proceed or Cancel to abort.'
    );

    if (!confirmed) {
      return;
    }

    try {
      showStatus('Resetting all data...');
      
      // Initialize storage if needed and clear all URLs
      await tabStorage.init();
      await tabStorage.clearAllUrls();
      
      showStatus('All data has been reset successfully');
    } catch (error) {
      console.error('Error resetting data:', error);
      showStatus(`Error resetting data: ${error.message}`, true);
    }
  }
});