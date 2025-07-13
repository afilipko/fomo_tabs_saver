// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const exportCurrentBtn = document.getElementById('exportCurrentWindow');
  const exportAllBtn = document.getElementById('exportAllWindows');
  const viewSavedBtn = document.getElementById('viewSavedExports');
  const statusDiv = document.getElementById('status');

  exportCurrentBtn.addEventListener('click', () => exportTabs(false));
  exportAllBtn.addEventListener('click', () => exportTabs(true));
  viewSavedBtn.addEventListener('click', showSavedExports);

  function getSelectedFormat() {
    const selectedRadio = document.querySelector('input[name="format"]:checked');
    return selectedRadio ? selectedRadio.value : 'simple';
  }

  function getSaveToIndexedDB() {
    const checkbox = document.getElementById('saveToIndexedDB');
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

      // Skip if URL matches auth/login patterns
      const url = tab.url.toLowerCase();
      const title = tab.title.toLowerCase();

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

  function formatTabs(tabs, format) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');

    switch (format) {
      case 'markdown':
        const content = tabs.map(tab => {
          const tags = tab.contentTags?.tags?.length > 0 ? ` #${tab.contentTags.tags.join(' #')}` : '';
          const categories = tab.contentTags?.categories?.length > 0 ? ` [${tab.contentTags.categories.join(', ')}]` : '';
          const contentTags = tab.contentTags;
          let metaInfo = '';

          if (contentTags) {
            const metaParts = [];
            if (contentTags.description) metaParts.push(`"${contentTags.description.substring(0, 100)}..."`);
            if (contentTags.author) metaParts.push(`by ${contentTags.author}`);
            if (contentTags.publishedDate) metaParts.push(`published ${contentTags.publishedDate}`);
            if (metaParts.length > 0) metaInfo = `\n  > ${metaParts.join(' | ')}`;
          }

          return `- [${tab.title}](${tab.url})${categories}${tags}${metaInfo}`;
        }).join('\n');
        return {
          content: `# Chrome Tabs Export - ${new Date().toLocaleString()}\n\n${content}`,
          filename: `chrome-tabs-${timestamp}.md`
        };

      case 'json':
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
          filename: `chrome-tabs-${timestamp}.json`
        };

      default: // simple
        const simpleContent = tabs.map(tab => {
          const categories = tab.contentTags?.categories?.length > 0 ? ` [${tab.contentTags.categories.join(', ')}]` : '';
          return `${tab.title} - ${tab.url}${categories}`;
        }).join('\n');
        return {
          content: `Chrome Tabs Export - ${new Date().toLocaleString()}\n\n${simpleContent}`,
          filename: `chrome-tabs-${timestamp}.txt`
        };
    }
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

        const format = getSelectedFormat();
        const saveToIndexedDB = getSaveToIndexedDB();
        const exportType = allWindows ? 'all' : 'current';

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

          // Save to IndexedDB if requested
          if (saveToIndexedDB) {
            const exportId = await tabStorage.saveTabExport(tabsToExport, format, exportType);
            showStatus(`Saved ${tabsToExport.length} tabs to local storage (ID: ${exportId})`);
          }

          // Also create downloadable file
          const { content, filename } = formatTabs(tabsToExport, format);
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          console.log('content filename', content, filename);
          chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              showStatus(`Download failed: ${chrome.runtime.lastError.message}`, true);
            } else {
              const message = saveToIndexedDB ?
                `Exported ${tabs.length} tabs (saved & downloaded)` :
                `Exported ${tabs.length} tabs successfully!`;
              showStatus(message);
            }

            // Clean up the blob URL
            URL.revokeObjectURL(url);
          });
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
      const exports = await tabStorage.getAllExports();

      if (exports.length === 0) {
        showStatus('No saved exports found');
        return;
      }

      // Create a simple list view
      const exportsList = exports.map(exp => {
        const date = new Date(exp.timestamp).toLocaleString();
        return `${date} - ${exp.tabCount} tabs (${exp.format}, ${exp.exportType})`;
      }).join('\n');

      // For now, show in a simple alert - could be enhanced with a proper modal
      const selectedIndex = prompt(`Saved Exports:\n\n${exportsList}\n\nEnter number (1-${exports.length}) to download, or cancel:`);

      if (selectedIndex && !isNaN(selectedIndex)) {
        const index = parseInt(selectedIndex) - 1;
        if (index >= 0 && index < exports.length) {
          await downloadSavedExport(exports[index]);
        }
      }
    } catch (error) {
      showStatus(`Error loading saved exports: ${error.message}`, true);
    }
  }

  async function downloadSavedExport(exportData) {
    try {
      const { content, filename } = tabStorage.formatExportForDownload(exportData);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      console.log(content, filename)
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          showStatus(`Download failed: ${chrome.runtime.lastError.message}`, true);
        } else {
          showStatus('Saved export downloaded successfully!');
        }
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      showStatus(`Error downloading saved export: ${error.message}`, true);
    }
  }
});