class TabViewer {
    constructor() {
        this.tabData = [];
        this.filteredData = [];
        this.currentSort = { field: 'lastSeen', direction: 'desc' };
        this.tabStorage = new TabStorage();
        
        this.initializeElements();
        this.bindEvents();
        this.loadFromIndexedDB();
    }

    initializeElements() {
        this.searchInput = document.getElementById('searchInput');
        this.categoryFilter = document.getElementById('categoryFilter');
        this.domainFilter = document.getElementById('domainFilter');
        this.totalCount = document.getElementById('totalCount');
        this.filteredCount = document.getElementById('filteredCount');
        this.loadingMessage = document.getElementById('loadingMessage');
        this.noDataMessage = document.getElementById('noDataMessage');
        this.tabTable = document.getElementById('tabTable');
        this.tabTableBody = document.getElementById('tabTableBody');
        this.statsContainer = document.getElementById('statsContainer');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.exportBtn = document.getElementById('exportBtn');
        this.clearBtn = document.getElementById('clearBtn');
    }

    bindEvents() {
        this.searchInput.addEventListener('input', () => this.applyFilters());
        this.categoryFilter.addEventListener('change', () => this.applyFilters());
        this.domainFilter.addEventListener('change', () => this.applyFilters());
        
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener('click', () => this.loadFromIndexedDB());
        }
        
        if (this.exportBtn) {
            this.exportBtn.addEventListener('click', () => this.exportData());
        }
        
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearAllData());
        }

        // Bind sort events
        document.querySelectorAll('[data-sort]').forEach(header => {
            header.addEventListener('click', (e) => {
                const field = e.target.getAttribute('data-sort');
                this.handleSort(field);
            });
        });
    }

    async loadFromIndexedDB() {
        this.showLoading();
        
        try {
            await this.tabStorage.init();
            this.tabData = await this.tabStorage.getAllUrls({ sortBy: 'lastSeen', sortOrder: 'desc' });
            
            if (this.tabData.length === 0) {
                this.showNoData();
                return;
            }
            
            this.populateFilters();
            this.applyFilters();
            this.showTable();
            this.displayStats();
        } catch (error) {
            console.error('Error loading data from IndexedDB:', error);
            this.showNoData();
            alert('Error loading saved URLs from local storage: ' + error.message);
        }
    }

    async displayStats() {
        try {
            const stats = await this.tabStorage.getStats();
            
            if (this.statsContainer) {
                this.statsContainer.innerHTML = `
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-number">${stats.totalUrls}</div>
                            <div class="stat-label">Total URLs</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${stats.uniqueDomains}</div>
                            <div class="stat-label">Domains</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${stats.uniqueCategories}</div>
                            <div class="stat-label">Categories</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${stats.totalAccesses}</div>
                            <div class="stat-label">Total Visits</div>
                        </div>
                    </div>
                    <div class="top-lists">
                        <div class="top-domains">
                            <h4>Top Domains</h4>
                            ${stats.topDomains.map(item => `<div>${item.domain} (${item.count})</div>`).join('')}
                        </div>
                        <div class="top-categories">
                            <h4>Top Categories</h4>
                            ${stats.topCategories.map(item => `<div>${item.category} (${item.count})</div>`).join('')}
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    populateFilters() {
        // Populate category filter
        const categories = new Set();
        const domains = new Set();

        this.tabData.forEach(tab => {
            tab.categories.forEach(cat => categories.add(cat));
            if (tab.domain) domains.add(tab.domain);
        });

        this.populateSelectOptions(this.categoryFilter, Array.from(categories).sort());
        this.populateSelectOptions(this.domainFilter, Array.from(domains).sort());
    }

    populateSelectOptions(selectElement, options) {
        // Clear existing options except the first one
        while (selectElement.children.length > 1) {
            selectElement.removeChild(selectElement.lastChild);
        }

        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            selectElement.appendChild(optionElement);
        });
    }

    applyFilters() {
        const searchTerm = this.searchInput.value.toLowerCase();
        const categoryFilter = this.categoryFilter.value;
        const domainFilter = this.domainFilter.value;

        this.filteredData = this.tabData.filter(tab => {
            // Search filter - search in title, URL, description, and tags
            const searchMatch = !searchTerm || 
                tab.title.toLowerCase().includes(searchTerm) ||
                tab.url.toLowerCase().includes(searchTerm) ||
                (tab.description && tab.description.toLowerCase().includes(searchTerm)) ||
                (tab.author && tab.author.toLowerCase().includes(searchTerm)) ||
                tab.tags.some(tag => tag.toLowerCase().includes(searchTerm)) ||
                tab.categories.some(category => category.toLowerCase().includes(searchTerm));

            // Category filter
            const categoryMatch = !categoryFilter || tab.categories.includes(categoryFilter);

            // Domain filter
            const domainMatch = !domainFilter || tab.domain === domainFilter;

            return searchMatch && categoryMatch && domainMatch;
        });

        this.renderTable();
        this.updateStats();
    }

    handleSort(field) {
        if (this.currentSort.field === field) {
            this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.field = field;
            this.currentSort.direction = 'asc';
        }

        this.filteredData.sort((a, b) => {
            let aVal = a[field];
            let bVal = b[field];

            // Handle arrays (categories, tags)
            if (Array.isArray(aVal)) aVal = aVal.join(', ');
            if (Array.isArray(bVal)) bVal = bVal.join(', ');

            // Handle dates
            if (field === 'lastSeen' || field === 'firstSeen') {
                aVal = new Date(aVal);
                bVal = new Date(bVal);
            }

            // Handle strings
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();

            let result = 0;
            if (aVal < bVal) result = -1;
            else if (aVal > bVal) result = 1;

            return this.currentSort.direction === 'desc' ? -result : result;
        });

        this.updateSortIndicators();
        this.renderTable();
    }

    updateSortIndicators() {
        document.querySelectorAll('.sort-indicator').forEach(indicator => {
            indicator.textContent = '';
        });

        if (this.currentSort.field) {
            const indicator = document.querySelector(`[data-sort="${this.currentSort.field}"] .sort-indicator`);
            if (indicator) {
                indicator.textContent = this.currentSort.direction === 'asc' ? '↑' : '↓';
            }
        }
    }

    renderTable() {
        this.tabTableBody.innerHTML = '';

        this.filteredData.forEach(tab => {
            const row = document.createElement('tr');
            row.innerHTML = this.createTableRow(tab);
            this.tabTableBody.appendChild(row);
        });
    }

    createTableRow(tab) {
        const categoriesHtml = tab.categories.map(cat => 
            `<span class="category-tag">${cat}</span>`
        ).join('');

        const tagsHtml = tab.tags.slice(0, 6).map(tag => 
            `<span class="tag">${tag}</span>`
        ).join('');

        const confidencePercent = Math.round(tab.confidence * 100);

        const descriptionHtml = tab.description ? 
            `<div class="description">${this.escapeHtml(tab.description.substring(0, 150))}${tab.description.length > 150 ? '...' : ''}</div>` : 
            '<div class="no-description">No description available</div>';
        
        const imageHtml = tab.image ? 
            `<img src="${this.escapeHtml(tab.image)}" alt="Page preview" class="page-image" onerror="this.style.display='none'" />` : 
            '<div class="no-image">📄</div>';
        
        const authorHtml = tab.author ? 
            `<div class="author">by ${this.escapeHtml(tab.author)}</div>` : '';
        
        const dateHtml = tab.publishedDate ? 
            `<div class="date">Published: ${this.formatDate(tab.publishedDate)}</div>` : '';
        
        const wordCountHtml = tab.wordCount ? 
            `<div class="word-count">${tab.wordCount} words</div>` : '';

        const accessInfo = `
            <div class="access-info">
                <div class="access-count">Visited ${tab.accessCount} time${tab.accessCount > 1 ? 's' : ''}</div>
                <div class="first-seen">First seen: ${this.formatDate(tab.firstSeen)}</div>
                <div class="last-seen">Last seen: ${this.formatDate(tab.lastSeen)}</div>
            </div>
        `;

        return `
            <td>
                <div class="tab-title">${this.escapeHtml(tab.title)}</div>
                <div class="tab-url">
                    <a href="${tab.url}" target="_blank">${this.escapeHtml(tab.url)}</a>
                </div>
                ${accessInfo}
            </td>
            <td>${this.escapeHtml(tab.domain)}</td>
            <td>
                <div class="categories">${categoriesHtml}</div>
            </td>
            <td>
                <div style="font-size: 12px; color: #2c3e50; font-weight: 500;">${confidencePercent}%</div>
                <div style="font-size: 10px; color: #7f8c8d;">confidence</div>
            </td>
            <td>
                <div class="tags">${tagsHtml}</div>
            </td>
            <td>
                <div class="content-preview">
                    <div class="image-container">${imageHtml}</div>
                    <div class="content-details">
                        ${descriptionHtml}
                        <div class="meta-info">
                            ${authorHtml}
                            ${dateHtml}
                            ${wordCountHtml}
                        </div>
                    </div>
                </div>
            </td>
        `;
    }

    updateStats() {
        this.totalCount.textContent = this.tabData.length;
        this.filteredCount.textContent = this.filteredData.length;
    }

    showLoading() {
        this.loadingMessage.style.display = 'block';
        this.noDataMessage.style.display = 'none';
        this.tabTable.style.display = 'none';
        if (this.statsContainer) this.statsContainer.style.display = 'none';
    }

    showTable() {
        this.loadingMessage.style.display = 'none';
        this.noDataMessage.style.display = 'none';
        this.tabTable.style.display = 'table';
        if (this.statsContainer) this.statsContainer.style.display = 'block';
    }

    showNoData() {
        this.loadingMessage.style.display = 'none';
        this.noDataMessage.style.display = 'block';
        this.tabTable.style.display = 'none';
        if (this.statsContainer) this.statsContainer.style.display = 'none';
    }

    async exportData() {
        try {
            const format = prompt('Export format (json/csv/markdown/simple):', 'json');
            if (!format) return;

            const exportData = this.tabStorage.formatUrlsForExport(this.filteredData.length > 0 ? this.filteredData : this.tabData, format);
            
            const blob = new Blob([exportData.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = exportData.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            alert('Export completed successfully!');
        } catch (error) {
            console.error('Export error:', error);
            alert('Export failed: ' + error.message);
        }
    }

    async clearAllData() {
        if (!confirm('Are you sure you want to delete ALL saved URLs? This cannot be undone.')) {
            return;
        }

        try {
            await this.tabStorage.clearAllUrls();
            this.tabData = [];
            this.filteredData = [];
            this.showNoData();
            alert('All saved URLs have been deleted.');
        } catch (error) {
            console.error('Clear error:', error);
            alert('Failed to clear data: ' + error.message);
        }
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateString;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the viewer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TabViewer();
});