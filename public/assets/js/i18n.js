// Translations
const translations = {
  en: {
    // Header
    pageTitle: 'Approval Request System',
    pageSubtitle: 'Create a new approval request',
    dashboardTitle: 'Dashboard',
    dashboardSubtitle: 'Overview of all approval requests',
    
    // Stats
    statPending: 'Pending',
    statApproved: 'Approved',
    statRejected: 'Rejected',
    
    // Dashboard
    recentRequests: 'Recent Requests',
    loadingRequests: 'Loading requests...',
    noRequests: 'No requests found',
    viewDetails: 'View Details',
    
    // Form labels
    labelTitle: 'Request Title',
    labelDescription: 'Description',
    labelType: 'Request Type',
    labelPriority: 'Priority',
    labelApprover: 'Approver',
    labelStatus: 'Status',
    labelCreatedBy: 'Created By',
    labelCreatedAt: 'Created At',
    
    // Placeholders
    placeholderTitle: 'e.g. Vacation Approval',
    placeholderDescription: 'Describe your request details...',
    placeholderType: '-- Select type --',
    placeholderPriority: '-- Select priority --',
    placeholderApprover: '-- Select approver --',
    placeholderLoading: '-- Loading users... --',
    
    // Request types
    typeVacation: 'Vacation',
    typePurchase: 'Purchase',
    typeExpense: 'Expense',
    typeHr: 'HR Matters',
    typeOther: 'Other',
    
    // Priority levels
    priorityLow: 'Low',
    priorityMedium: 'Medium',
    priorityHigh: 'High',
    priorityUrgent: 'Urgent',
    
    // Status
    statusPending: 'Pending',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    
    // Helper texts
    helperDescription: 'Provide all relevant information',
    helperApprover: 'Select the person who should approve this request',
    
    // Button
    btnSubmit: 'Submit Request',
    btnSubmitting: 'Submitting...',
    btnApprove: 'Approve',
    btnReject: 'Reject',
    
    // Alerts
    alertSuccess: '✓ Request successfully created and sent for approval!',
    alertError: '✗ ',
    alertErrorLoading: 'Error loading approvers list',
    alertErrorInit: 'Error initializing Teams SDK',
    alertErrorSubmit: 'Error creating request',
    
    // Required field
    required: '*'
  },
  sk: {
    // Header
    pageTitle: 'Systém schvaľovania žiadostí',
    pageSubtitle: 'Vytvorte novú žiadosť o schválenie',
    dashboardTitle: 'Nástenka',
    dashboardSubtitle: 'Prehľad všetkých žiadostí o schválenie',
    
    // Stats
    statPending: 'Čaká na schválenie',
    statApproved: 'Schválené',
    statRejected: 'Zamietnuté',
    
    // Dashboard
    recentRequests: 'Posledné žiadosti',
    loadingRequests: 'Načítavam žiadosti...',
    noRequests: 'Neboli nájdené žiadne žiadosti',
    viewDetails: 'Zobraziť detail',
    
    // Form labels
    labelTitle: 'Názov žiadosti',
    labelDescription: 'Popis',
    labelType: 'Typ žiadosti',
    labelPriority: 'Priorita',
    labelApprover: 'Schvaľovateľ',
    labelStatus: 'Stav',
    labelCreatedBy: 'Vytvoril',
    labelCreatedAt: 'Vytvorené',
    
    // Placeholders
    placeholderTitle: 'Napr. Schválenie dovolenky',
    placeholderDescription: 'Popíšte detaily vašej žiadosti...',
    placeholderType: '-- Vyberte typ --',
    placeholderPriority: '-- Vyberte prioritu --',
    placeholderApprover: '-- Vyberte schvaľovateľa --',
    placeholderLoading: '-- Načítavam používateľov... --',
    
    // Request types
    typeVacation: 'Dovolenka',
    typePurchase: 'Nákup',
    typeExpense: 'Výdavky',
    typeHr: 'HR záležitosti',
    typeOther: 'Iné',
    
    // Priority levels
    priorityLow: 'Nízka',
    priorityMedium: 'Stredná',
    priorityHigh: 'Vysoká',
    priorityUrgent: 'Urgentná',
    
    // Status
    statusPending: 'Čaká na schválenie',
    statusApproved: 'Schválené',
    statusRejected: 'Zamietnuté',
    
    // Helper texts
    helperDescription: 'Uveďte všetky relevantné informácie',
    helperApprover: 'Vyberte osobu, ktorá má žiadosť schváliť',
    
    // Button
    btnSubmit: 'Odoslať žiadosť',
    btnSubmitting: 'Odosiela sa...',
    btnApprove: 'Schváliť',
    btnReject: 'Zamietnuť',
    
    // Alerts
    alertSuccess: '✓ Žiadosť bola úspešne vytvorená a odoslaná na schválenie!',
    alertError: '✗ ',
    alertErrorLoading: 'Chyba pri načítaní zoznamu schvaľovateľov',
    alertErrorInit: 'Chyba pri inicializácii Teams SDK',
    alertErrorSubmit: 'Chyba pri vytváraní žiadosti',
    
    // Required field
    required: '*'
  }
};

// Current language (default: English)
let currentLang = localStorage.getItem('appLanguage') || 'en';

// Get translation
function t(key) {
  return translations[currentLang][key] || key;
}

// Switch language
function switchLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('appLanguage', lang);
  updatePageLanguage();
  
  // Reload navigation if exists
  const navContainer = document.getElementById('navContainer');
  if (navContainer && typeof renderNavigation === 'function') {
    navContainer.innerHTML = '';
    const currentPage = document.body.getAttribute('data-page');
    navContainer.appendChild(renderNavigation(currentPage));
  }
}

// Update all text on page
function updatePageLanguage() {
  // Update data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  // Update data-i18n-placeholder elements
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // Update language toggle buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-lang="${currentLang}"]`)?.classList.add('active');
}

// Initialize language on page load
document.addEventListener('DOMContentLoaded', () => {
  updatePageLanguage();
});
