// indexeddb.js - IndexedDB helper functions for tab data storage

class TabStorage {
  constructor() {
    this.dbName = 'TabExporterDB';
    this.dbVersion = 1;
    this.storeName = 'tabExports';
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('format', 'format', { unique: false });
          store.createIndex('windowCount', 'windowCount', { unique: false });
        }
      };
    });
  }

  async saveTabExport(tabsData, format, exportType) {
    if (!this.db) await this.init();

    const exportData = {
      timestamp: new Date().toISOString(),
      format: format,
      exportType: exportType, // 'current' or 'all'
      windowCount: this.getWindowCount(tabsData),
      tabCount: tabsData.length,
      tabs: tabsData.map(tab => ({
        title: tab.title,
        url: tab.url,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        pinned: tab.pinned,
        favIconUrl: tab.favIconUrl
      }))
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(exportData);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllExports() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => {
        const exports = request.result.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        resolve(exports);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getExportById(id) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteExport(id) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllExports() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  getWindowCount(tabs) {
    const windowIds = new Set(tabs.map(tab => tab.windowId));
    return windowIds.size;
  }

  formatExportForDownload(exportData) {
    const timestamp = new Date(exportData.timestamp).toISOString().slice(0, 19).replace(/[:.]/g, '-');
    
    switch (exportData.format) {
      case 'markdown':
        const content = exportData.tabs.map(tab => `- [${tab.title}](${tab.url})`).join('\n');
        return {
          content: `# Chrome Tabs Export - ${new Date(exportData.timestamp).toLocaleString()}\n\n${content}`,
          filename: `chrome-tabs-${timestamp}.md`
        };

      case 'json':
        return {
          content: JSON.stringify(exportData, null, 2),
          filename: `chrome-tabs-${timestamp}.json`
        };

      default: // simple
        const simpleContent = exportData.tabs.map(tab => `${tab.title} - ${tab.url}`).join('\n');
        return {
          content: `Chrome Tabs Export - ${new Date(exportData.timestamp).toLocaleString()}\n\n${simpleContent}`,
          filename: `chrome-tabs-${timestamp}.txt`
        };
    }
  }
}

// Create global instance
const tabStorage = new TabStorage();