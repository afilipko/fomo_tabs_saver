// indexeddb.js - IndexedDB helper functions for individual URL storage

class TabStorage {
  constructor() {
    this.dbName = 'FomoTabsDB';
    this.dbVersion = 2;
    this.urlStoreName = 'urls';
    this.exportStoreName = 'tabExports'; // Keep for migration
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
        
        // Create URLs store for individual URL storage
        if (!db.objectStoreNames.contains(this.urlStoreName)) {
          const urlStore = db.createObjectStore(this.urlStoreName, { 
            keyPath: 'url'  // URL as primary key for natural deduplication
          });
          
          // Indexes for efficient querying
          urlStore.createIndex('domain', 'domain', { unique: false });
          urlStore.createIndex('firstSeen', 'firstSeen', { unique: false });
          urlStore.createIndex('lastSeen', 'lastSeen', { unique: false });
          urlStore.createIndex('accessCount', 'accessCount', { unique: false });
          urlStore.createIndex('categories', 'categories', { unique: false, multiEntry: true });
          urlStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        }
        
        // Keep old store for backward compatibility
        if (!db.objectStoreNames.contains(this.exportStoreName)) {
          const exportStore = db.createObjectStore(this.exportStoreName, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          exportStore.createIndex('timestamp', 'timestamp', { unique: false });
          exportStore.createIndex('format', 'format', { unique: false });
          exportStore.createIndex('windowCount', 'windowCount', { unique: false });
        }
      };
    });
  }

  // Save individual URLs with deduplication and metadata
  async saveUrls(tabsData, options = { append: true }) {
    if (!this.db) await this.init();

    const results = {
      saved: 0,
      updated: 0,
      errors: []
    };

    for (const tab of tabsData) {
      try {
        await this.saveUrl(tab, options.append);
        const existing = await this.getUrl(tab.url);
        if (existing && existing.accessCount > 1) {
          results.updated++;
        } else {
          results.saved++;
        }
      } catch (error) {
        results.errors.push({ url: tab.url, error: error.message });
      }
    }

    return results;
  }

  // Save or update a single URL
  async saveUrl(tabData, append = true) {
    if (!this.db) await this.init();

    const now = new Date().toISOString();
    const domain = this.extractDomain(tabData.url);
    
    // Check if URL already exists
    const existing = await this.getUrl(tabData.url);
    
    let urlRecord;
    if (existing && append) {
      // Update existing record
      urlRecord = {
        ...existing,
        title: tabData.title, // Update title in case it changed
        lastSeen: now,
        accessCount: (existing.accessCount || 1) + 1,
        // Update content tags if available
        ...(tabData.contentTags && {
          categories: tabData.contentTags.categories || existing.categories,
          confidence: tabData.contentTags.confidence || existing.confidence,
          tags: tabData.contentTags.tags || existing.tags,
          description: tabData.contentTags.description || existing.description,
          image: tabData.contentTags.image || existing.image,
          author: tabData.contentTags.author || existing.author,
          publishedDate: tabData.contentTags.publishedDate || existing.publishedDate,
          wordCount: tabData.contentTags.wordCount || existing.wordCount,
          language: tabData.contentTags.language || existing.language
        })
      };
    } else {
      // Create new record
      urlRecord = {
        url: tabData.url,
        title: tabData.title,
        domain: domain,
        firstSeen: now,
        lastSeen: now,
        accessCount: 1,
        categories: tabData.contentTags?.categories || [],
        confidence: tabData.contentTags?.confidence || 0,
        tags: tabData.contentTags?.tags || [],
        description: tabData.contentTags?.description || '',
        image: tabData.contentTags?.image || '',
        author: tabData.contentTags?.author || '',
        publishedDate: tabData.contentTags?.publishedDate || '',
        wordCount: tabData.contentTags?.wordCount || 0,
        language: tabData.contentTags?.language || '',
        favIconUrl: tabData.favIconUrl || ''
      };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readwrite');
      const store = transaction.objectStore(this.urlStoreName);
      const request = store.put(urlRecord); // put() handles both insert and update

      request.onsuccess = () => resolve(urlRecord);
      request.onerror = () => reject(request.error);
    });
  }

  // Get a single URL by its URL key
  async getUrl(url) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readonly');
      const store = transaction.objectStore(this.urlStoreName);
      const request = store.get(url);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all URLs sorted by last seen (most recent first)
  async getAllUrls(options = {}) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readonly');
      const store = transaction.objectStore(this.urlStoreName);
      const request = store.getAll();

      request.onsuccess = () => {
        let urls = request.result;
        
        // Apply sorting
        const sortBy = options.sortBy || 'lastSeen';
        const sortOrder = options.sortOrder || 'desc';
        
        urls.sort((a, b) => {
          let aVal = a[sortBy];
          let bVal = b[sortBy];
          
          if (sortBy === 'lastSeen' || sortBy === 'firstSeen') {
            aVal = new Date(aVal);
            bVal = new Date(bVal);
          }
          
          if (sortOrder === 'desc') {
            return bVal > aVal ? 1 : -1;
          } else {
            return aVal > bVal ? 1 : -1;
          }
        });
        
        // Apply pagination if requested
        if (options.limit) {
          const offset = options.offset || 0;
          urls = urls.slice(offset, offset + options.limit);
        }
        
        resolve(urls);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Search URLs by title, domain, or tags
  async searchUrls(query, options = {}) {
    const allUrls = await this.getAllUrls();
    const queryLower = query.toLowerCase();
    
    return allUrls.filter(url => {
      return url.title.toLowerCase().includes(queryLower) ||
             url.domain.toLowerCase().includes(queryLower) ||
             url.url.toLowerCase().includes(queryLower) ||
             url.description.toLowerCase().includes(queryLower) ||
             url.categories.some(cat => cat.toLowerCase().includes(queryLower)) ||
             url.tags.some(tag => tag.toLowerCase().includes(queryLower));
    });
  }

  // Get URLs by category
  async getUrlsByCategory(category) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readonly');
      const store = transaction.objectStore(this.urlStoreName);
      const index = store.index('categories');
      const request = index.getAll(category);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Get URLs by domain
  async getUrlsByDomain(domain) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readonly');
      const store = transaction.objectStore(this.urlStoreName);
      const index = store.index('domain');
      const request = index.getAll(domain);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Delete a URL
  async deleteUrl(url) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readwrite');
      const store = transaction.objectStore(this.urlStoreName);
      const request = store.delete(url);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all URLs
  async clearAllUrls() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.urlStoreName], 'readwrite');
      const store = transaction.objectStore(this.urlStoreName);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // Get database statistics
  async getStats() {
    const urls = await this.getAllUrls();
    const domains = new Set(urls.map(url => url.domain));
    const categories = new Set(urls.flatMap(url => url.categories));
    
    return {
      totalUrls: urls.length,
      uniqueDomains: domains.size,
      uniqueCategories: categories.size,
      totalAccesses: urls.reduce((sum, url) => sum + url.accessCount, 0),
      topDomains: this.getTopDomains(urls, 10),
      topCategories: this.getTopCategories(urls, 10)
    };
  }

  // Utility method to extract domain from URL
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return 'unknown';
    }
  }

  // Get top domains by URL count
  getTopDomains(urls, limit = 10) {
    const domainCounts = {};
    urls.forEach(url => {
      domainCounts[url.domain] = (domainCounts[url.domain] || 0) + 1;
    });
    
    return Object.entries(domainCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([domain, count]) => ({ domain, count }));
  }

  // Get top categories by URL count
  getTopCategories(urls, limit = 10) {
    const categoryCounts = {};
    urls.forEach(url => {
      url.categories.forEach(category => {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      });
    });
    
    return Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([category, count]) => ({ category, count }));
  }

  // Format URLs for export in different formats
  formatUrlsForExport(urls, format = 'json') {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    
    switch (format) {
      case 'markdown':
        const content = urls.map(url => {
          let line = `- [${url.title}](${url.url})`;
          if (url.categories.length > 0) {
            line += ` (${url.categories.join(', ')})`;
          }
          if (url.description) {
            line += `\n  ${url.description}`;
          }
          return line;
        }).join('\n');
        return {
          content: `# Saved URLs Export - ${new Date().toLocaleString()}\n\nTotal: ${urls.length} URLs\n\n${content}`,
          filename: `saved-urls-${timestamp}.md`
        };

      case 'json':
        return {
          content: JSON.stringify({
            exportDate: new Date().toISOString(),
            totalUrls: urls.length,
            urls: urls
          }, null, 2),
          filename: `saved-urls-${timestamp}.json`
        };

      case 'csv':
        const headers = 'URL,Title,Domain,Categories,Tags,Description,First Seen,Last Seen,Access Count';
        const rows = urls.map(url => [
          url.url,
          url.title,
          url.domain,
          url.categories.join(';'),
          url.tags.join(';'),
          url.description,
          url.firstSeen,
          url.lastSeen,
          url.accessCount
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));
        return {
          content: [headers, ...rows].join('\n'),
          filename: `saved-urls-${timestamp}.csv`
        };

      default: // simple text
        const simpleContent = urls.map(url => `${url.title} - ${url.url}`).join('\n');
        return {
          content: `Saved URLs Export - ${new Date().toLocaleString()}\n\n${simpleContent}`,
          filename: `saved-urls-${timestamp}.txt`
        };
    }
  }

  getWindowCount(tabs) {
    const windowIds = new Set(tabs.map(tab => tab.windowId));
    return windowIds.size;
  }
}

// Create global instance
const tabStorage = new TabStorage();