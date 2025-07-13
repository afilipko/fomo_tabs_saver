class TabViewer {
    constructor() {
        this.tabData = [];
        this.filteredData = [];
        this.currentSort = { field: null, direction: 'asc' };
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.fileInput = document.getElementById('jsonFile');
        this.fileName = document.getElementById('fileName');
        this.currentFile = document.getElementById('currentFile');
        this.searchInput = document.getElementById('searchInput');
        this.categoryFilter = document.getElementById('categoryFilter');
        this.domainFilter = document.getElementById('domainFilter');
        this.totalCount = document.getElementById('totalCount');
        this.filteredCount = document.getElementById('filteredCount');
        this.loadingMessage = document.getElementById('loadingMessage');
        this.noDataMessage = document.getElementById('noDataMessage');
        this.tabTable = document.getElementById('tabTable');
        this.tabTableBody = document.getElementById('tabTableBody');
    }

    bindEvents() {
        this.fileInput.addEventListener('change', (e) => this.handleFileLoad(e));
        this.searchInput.addEventListener('input', () => this.applyFilters());
        this.categoryFilter.addEventListener('change', () => this.applyFilters());
        this.domainFilter.addEventListener('change', () => this.applyFilters());
        this.sentimentFilter.addEventListener('change', () => this.applyFilters());

        // Bind sort events
        document.querySelectorAll('[data-sort]').forEach(header => {
            header.addEventListener('click', (e) => {
                const field = e.target.getAttribute('data-sort');
                this.handleSort(field);
            });
        });
    }

    async handleFileLoad(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.showLoading();
        this.fileName.textContent = file.name;
        this.currentFile.textContent = file.name;

        try {
            const text = await file.text();
            const jsonData = JSON.parse(text);
            
            // Handle different JSON structures
            this.tabData = this.processJsonData(jsonData);
            this.populateFilters();
            this.applyFilters();
            this.showTable();
        } catch (error) {
            console.error('Error loading JSON:', error);
            alert('Error loading JSON file. Please check the format.');
            this.showNoData();
        }
    }

    processJsonData(jsonData) {
        let tabs = [];

        // Handle different JSON structures
        if (Array.isArray(jsonData)) {
            tabs = jsonData;
        } else if (jsonData.tabs && Array.isArray(jsonData.tabs)) {
            tabs = jsonData.tabs;
        } else if (jsonData.exportedTabs && Array.isArray(jsonData.exportedTabs)) {
            tabs = jsonData.exportedTabs;
        } else {
            // Try to find any array property that might contain tab data
            for (const key in jsonData) {
                if (Array.isArray(jsonData[key]) && jsonData[key].length > 0) {
                    tabs = jsonData[key];
                    break;
                }
            }
        }

        // Normalize tab data structure
        return tabs.map(tab => {
            // Handle different tab data structures
            const normalizedTab = {
                title: tab.title || tab.name || 'Untitled',
                url: tab.url || tab.href || '',
                domain: tab.domain || (tab.url ? new URL(tab.url).hostname : ''),
                categories: tab.categories || tab.contentTags?.categories || ['general'],
                confidence: tab.confidence || tab.contentTags?.confidence || 0,
                tags: tab.tags || tab.contentTags?.tags || [],
                description: tab.description || tab.contentTags?.description || null,
                image: tab.image || tab.contentTags?.image || null,
                author: tab.author || tab.contentTags?.author || null,
                publishedDate: tab.publishedDate || tab.contentTags?.publishedDate || null,
                wordCount: tab.wordCount || tab.contentTags?.wordCount || null,
                language: tab.language || tab.contentTags?.language || null
            };

            // Ensure arrays
            if (!Array.isArray(normalizedTab.categories)) {
                normalizedTab.categories = [normalizedTab.categories];
            }
            if (!Array.isArray(normalizedTab.tags)) {
                normalizedTab.tags = [normalizedTab.tags];
            }

            return normalizedTab;
        }).filter(tab => tab.url); // Filter out tabs without URLs
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
            `<div class="date">${this.formatDate(tab.publishedDate)}</div>` : '';
        
        const wordCountHtml = tab.wordCount ? 
            `<div class="word-count">${tab.wordCount} words</div>` : '';

        return `
            <td>
                <div class="tab-title">${this.escapeHtml(tab.title)}</div>
                <div class="tab-url">
                    <a href="${tab.url}" target="_blank">${this.escapeHtml(tab.url)}</a>
                </div>
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
    }

    showTable() {
        this.loadingMessage.style.display = 'none';
        this.noDataMessage.style.display = 'none';
        this.tabTable.style.display = 'table';
    }

    showNoData() {
        this.loadingMessage.style.display = 'none';
        this.noDataMessage.style.display = 'block';
        this.tabTable.style.display = 'none';
    }

    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
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