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

    // Dashboard overview
    dashVacationRemaining: 'Vacation remaining',
    dashParagraphRemaining: 'Paragraphs remaining',
    dashOcrRemaining: 'FMC remaining',
    dashSickRemaining: 'Sick days remaining',
    dashNextHoliday: 'Next holiday',
    dashYourTickets: 'Your Tickets',
    dashDays: 'days',
    dashHours: 'hours',
    dashUsed: 'used',
    dashNoQuota: 'Not set up yet',
    dashNoUpcomingHoliday: 'No upcoming holidays',
    dashMoreHolidays: 'more',
    dashToday: 'today',
    dashTomorrow: 'tomorrow',
    dashInDays: 'in {n} days',
    dashAllHolidays: 'All holidays',
    dashHolidaysTitle: 'Public Holidays',
    errorLoadingDashboard: 'Error loading dashboard',
    
    // Form labels
    labelTitle: 'Request Title',
    labelDescription: 'Description',
    labelType: 'Request Type',
    labelPriority: 'Priority',
    labelApprover: 'Approver',
    labelStatus: 'Status',
    labelCreatedBy: 'Created By',
    labelCreatedAt: 'Created At',
    labelRejectionReason: 'Rejection Reason',
    labelStartDate: 'Start Date',
    labelEndDate: 'End Date',
    labelPriorityLabel: 'Priority',
    
    // Placeholders
    placeholderTitle: 'e.g. Vacation Approval',
    placeholderDescription: 'Describe your request details...',
    placeholderType: '-- Select type --',
    placeholderPriority: '-- Select priority --',
    placeholderApprover: '-- Select approver --',
    placeholderLoading: '-- Loading users... --',
    
    // Request types
    typeVacation: 'Vacation',
    typeSickLeave: 'Sick Leave',
    typeParagraph: 'Paragraph Leave',
    typeOcr: 'Family Member Care',
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
    statusCancelled: 'Cancelled',
    
    // Helper texts
    helperDescription: 'Provide all relevant information',
    helperApprover: 'Select the person who should approve this request',
    labelAttachments: 'Attachments (optional)',
    helperAttachments: 'Allowed: JPG, JPEG, PNG, PDF, DOCX, XLSX (max 10MB)',
    
    // Button
    btnSubmit: 'Submit Request',
    btnSubmitting: 'Submitting...',
    btnApprove: 'Approve',
    btnReject: 'Reject',
    
    // Alerts
    alertSuccess: 'Request successfully created and sent for approval!',
    alertError: 'Error: ',
    alertErrorLoading: 'Error loading approvers list',
    alertErrorInit: 'Error initializing Teams SDK',
    alertErrorSubmit: 'Error creating request',

    // Quota info on create form
    quotaInfoRemaining: 'remaining',
    quotaInfoOf: 'of',
    quotaInfoDays: 'days',
    quotaInfoHours: 'hours',
    quotaInfoVacation: 'Vacation balance',
    quotaInfoSick: 'Sick days balance',
    quotaInfoParagraph: 'Paragraph leave balance',
    quotaInfoOcr: 'Family member care balance',
    quotaInfoNotSet: 'Quota not configured',

    // Approvals page
    approvalsTitle: 'Pending Approvals',
    approvalsSubtitle: 'Requests waiting for your approval',
    requestsToApprove: 'Requests to Approve',
    loadingApprovals: 'Loading pending approvals...',
    noPendingApprovals: 'No pending approvals',
    tabPending: 'Pending',
    tabHistory: 'History',
    approvalsHistory: 'Approval History',
    loadingHistory: 'Loading history...',
    noHistoryFound: 'No approval history found',
    attachments: 'Attachments',
    viewAttachments: 'View attachments',
    noAttachments: 'No attachments',
    errorLoadingHistory: 'Error loading history',
    filterStatus: 'Status',
    filterStatusAll: '-- All --',
    labelDate: 'Date',

    // My Requests page
    myRequestsTitle: 'My Requests',
    myRequestsSubtitle: 'View and track your submitted requests',
    yourRequests: 'Your Requests',
    loadingYourRequests: 'Loading your requests...',
    noRequestsFound: 'No requests found',
    filterSearch: 'Search',
    filterSearchPlaceholder: 'Search by title or description...',
    filterApprover: 'Filter by Approver',
    filterApproverAll: '-- All Approvers --',
    filterClear: 'Clear Filters',

    // Cancel ticket
    btnCancelTicket: 'Cancel Request',
    cancelModalTitle: 'Cancel Request',
    cancelModalDesc: 'Are you sure you want to cancel this request? If it was approved, the quota will be returned. The approver will be notified.',
    cancelReasonLabel: 'Cancellation reason',
    cancelReasonPlaceholder: 'Enter the reason for cancellation...',
    cancelReasonRequired: 'Cancellation reason is required',
    cancelSuccess: 'Request cancelled successfully!',
    cancelFailed: 'Failed to cancel request',
    cancelAfterStart: 'This request can no longer be cancelled – its start date has already begun or passed.',
    cancelReason: 'Cancellation reason',

    // Confirm dialogs
    confirmApprove: 'Are you sure you want to approve this request?',
    confirmReject: 'Please provide a reason for rejection:',

    // Reject modal
    rejectModalTitle: 'Rejection Reason',
    rejectModalPlaceholder: 'Please provide a reason for rejection...',
    rejectModalCancel: 'Cancel',
    rejectModalSubmit: 'Reject',
    rejectModalError: 'Please provide a reason for rejection',

    // Success/Error messages
    approveSuccess: 'Request approved successfully!',
    approveFailed: 'Failed to approve request',
    approveError: 'Error approving request',
    rejectSuccess: 'Request rejected successfully!',
    rejectFailed: 'Failed to reject request',
    rejectError: 'Error rejecting request',
    errorLoadingDashboard: 'Error loading dashboard',
    errorLoadingApprovals: 'Error loading approvals',
    errorLoadingRequests: 'Error loading requests',
    errorLoadingHistory: 'Error loading history',
    errorLoadingCalendar: 'Error loading calendar',

    // Team Calendar
    teamCalendarTitle: 'Team Calendar',
    teamCalendarSubtitle: "See who's off in selected date range",
    calendarToday: 'Today',
    calendarTomorrow: 'Tomorrow',
    calendarDayAfter: 'Day After Tomorrow',
    calendarNoOneOff: 'No one is off',
    loadingCalendar: 'Loading calendar...',
    labelDate: 'Date',
    calendarDateFrom: 'From',
    calendarDateTo: 'To',
    calendarApplyFilter: 'Apply',
    calendarQuickToday: 'Today',
    calendarQuickWeek: 'This week',
    calendarQuickMonth: 'This month',

    // Sick Notes page (Paragraphs & FMC)
    sickNotesTitle: 'Paragraphs & FMC',
    sickNotesSubtitle: 'Upload and manage your paragraph and FMC documents',
    sickNotesUploadTitle: 'Upload New Document',
    sickNotesListTitle: 'My Documents',
    sickNotesLabelDocType: 'Document Type',
    sickNotesDocTypeParagraph: 'Paragraph',
    sickNotesDocTypeOcr: 'Family Member Care',
    sickNotesLabelTitle: 'Title',
    sickNotesPlaceholderTitle: 'e.g. Paragraph - flu',
    sickNotesLabelDoctor: 'Doctor',
    sickNotesPlaceholderDoctor: 'e.g. MUDr. Novák',
    sickNotesLabelDiagnosis: 'Diagnosis',
    sickNotesPlaceholderDiagnosis: 'e.g. Acute respiratory infection',
    sickNotesLabelDateFrom: 'Date from',
    sickNotesLabelDateTo: 'Date to',
    sickNotesLabelFile: 'Document',
    sickNotesFileHint: 'PDF, JPG, PNG, HEIC (max 10MB)',
    sickNotesBtnSubmit: 'Upload Document',
    sickNotesBtnSubmitting: 'Uploading...',
    sickNotesEmpty: 'No documents found',
    sickNotesLoading: 'Loading documents...',
    sickNotesSuccess: 'Document uploaded successfully!',
    sickNotesError: 'Error uploading document',
    sickNotesDownload: 'Download',
    sickNotesStatus: 'Status',
    sickNotesStatusActive: 'Active',
    sickNotesStatusCompleted: 'Completed',
    sickNotesNoNotes: 'No documents found',
    sickNotesErrorLoading: 'Error loading documents',
    sickNotesErrorSubmit: 'Error creating document',
    sickNotesColTitle: 'Title',
    sickNotesColFrom: 'From',
    sickNotesColTo: 'To',
    sickNotesColDoctor: 'Doctor',
    sickNotesColFile: 'Document',
    sickNotesHelperFile: 'Max 10MB. Supported: PDF, JPG, PNG, HEIC, WebP',
    sickNotesViewDoc: 'View document',
    sickNotesNoFile: 'No document',
    sickNotesDays: 'days',
    sickNotesHours: 'hours',
    sickNotesDate: 'Date',
    sickNotesClose: 'Close',

    // Half-day vacation
    halfDayLabel: 'Half-day',
    halfDayFullDay: 'Full day',
    halfDayHalfDay: 'Half day (0.5)',
    halfDayHelperText: 'Select if you want to request only half a day off',

    // Selected days validation
    selectedDays: 'Selected working days',
    notEnoughDaysWarning: 'Not enough days! You selected {selected} days, but only {remaining} days remaining.',
    dateRangeError: 'Start date must be before end date',

    // Required field
    required: '*',

    // Out of Office widget
    dashOutOfOfficeTitle: 'Out of Office Today',
    dashOooNobody: 'Everyone is in the office today!',
    dashOooVacation: 'Vacation',
    dashOooSickLeave: 'Sick Leave',
    dashOooParagraph: 'Paragraph',
    dashOooOcr: 'Family Care'
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

    // Dashboard overview
    dashVacationRemaining: 'Zostatok dovolenky',
    dashParagraphRemaining: 'Zostatok paragrafov',
    dashOcrRemaining: 'Zostatok OČR',
    dashSickRemaining: 'Zostatok zdravotného voľna',
    dashNextHoliday: 'Najbližší sviatok',
    dashYourTickets: 'Vaše tikety',
    dashDays: 'dní',
    dashHours: 'hodín',
    dashUsed: 'vyčerpané',
    dashNoQuota: 'Zatiaľ nenastavené',
    dashNoUpcomingHoliday: 'Žiadne nadchádzajúce sviatky',
    dashMoreHolidays: 'ďalšie',
    dashToday: 'dnes',
    dashTomorrow: 'zajtra',
    dashInDays: 'o {n} dní',
    dashAllHolidays: 'Všetky sviatky',
    dashHolidaysTitle: 'Štátne sviatky',
    errorLoadingDashboard: 'Chyba pri načítaní dashboardu',
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
    labelRejectionReason: 'Dôvod zamietnutia',
    labelStartDate: 'Dátum od',
    labelEndDate: 'Dátum do',
    labelPriorityLabel: 'Priorita',
    
    // Placeholders
    placeholderTitle: 'Napr. Schválenie dovolenky',
    placeholderDescription: 'Popíšte detaily vašej žiadosti...',
    placeholderType: '-- Vyberte typ --',
    placeholderPriority: '-- Vyberte prioritu --',
    placeholderApprover: '-- Vyberte schvaľovateľa --',
    placeholderLoading: '-- Načítavam používateľov... --',
    
    // Request types
    typeVacation: 'Dovolenka',
    typeSickLeave: 'PN-ka',
    typeParagraph: 'Paragraf',
    typeOcr: 'OČR',
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
    statusCancelled: 'Zrušená',
    
    // Helper texts
    helperDescription: 'Uveďte všetky relevantné informácie',
    helperApprover: 'Vyberte osobu, ktorá má žiadosť schváliť',
    labelAttachments: 'Prílohy (voliteľné)',
    helperAttachments: 'Povolené: JPG, JPEG, PNG, PDF, DOCX, XLSX (max 10MB)',
    
    // Button
    btnSubmit: 'Odoslať žiadosť',
    btnSubmitting: 'Odosiela sa...',
    btnApprove: 'Schváliť',
    btnReject: 'Zamietnuť',
    
    // Alerts
    alertSuccess: 'Žiadosť bola úspešne vytvorená a odoslaná na schválenie!',
    alertError: 'Chyba: ',
    alertErrorLoading: 'Chyba pri načítaní zoznamu schvaľovateľov',
    alertErrorInit: 'Chyba pri inicializácii Teams SDK',
    alertErrorSubmit: 'Chyba pri vytváraní žiadosti',

    // Quota info on create form
    quotaInfoRemaining: 'zostáva',
    quotaInfoOf: 'z',
    quotaInfoDays: 'dní',
    quotaInfoHours: 'hodín',
    quotaInfoVacation: 'Zostatok dovolenky',
    quotaInfoSick: 'Zostatok sick days',
    quotaInfoParagraph: 'Zostatok paragrafov',
    quotaInfoOcr: 'Zostatok OČR',
    quotaInfoNotSet: 'Kvóta nenastavená',

    // Approvals page
    approvalsTitle: 'Čakajúce schválenia',
    approvalsSubtitle: 'Žiadosti čakajúce na vaše schválenie',
    requestsToApprove: 'Žiadosti na schválenie',
    loadingApprovals: 'Načítavam čakajúce schválenia...',
    noPendingApprovals: 'Žiadne čakajúce schválenia',
    tabPending: 'Čakajúce',
    tabHistory: 'História',
    approvalsHistory: 'História schválení',
    loadingHistory: 'Načítavam históriu...',
    noHistoryFound: 'Nenašla sa žiadna história schválení',
    attachments: 'Prílohy',
    viewAttachments: 'Zobraziť prílohy',
    noAttachments: 'Žiadne prílohy',
    errorLoadingHistory: 'Chyba pri načítaní histórie',
    filterStatus: 'Stav',
    filterStatusAll: '-- Všetky --',
    labelDate: 'Dátum',

    // My Requests page
    myRequestsTitle: 'Moje žiadosti',
    myRequestsSubtitle: 'Zobraziť a sledovať vaše odoslané žiadosti',
    yourRequests: 'Vaše žiadosti',
    loadingYourRequests: 'Načítavam vaše žiadosti...',
    noRequestsFound: 'Neboli nájdené žiadne žiadosti',
    filterSearch: 'Vyhľadávanie',
    filterSearchPlaceholder: 'Hľadať podľa názvu alebo popisu...',
    filterApprover: 'Filtrovať podľa schvaľovateľa',
    filterApproverAll: '-- Všetci schvaľovatelia --',
    filterClear: 'Zrušiť filtre',

    // Cancel ticket
    btnCancelTicket: 'Zrušiť žiadosť',
    cancelModalTitle: 'Zrušiť žiadosť',
    cancelModalDesc: 'Naozaj chcete zrušiť túto žiadosť? Ak bola schválená, kvóta bude vrátená. Schvaľovateľ bude o zrušení informovaný.',
    cancelReasonLabel: 'Dôvod zrušenia',
    cancelReasonPlaceholder: 'Napíšte dôvod prečo žiadosť rušíte...',
    cancelReasonRequired: 'Dôvod zrušenia je povinný',
    cancelSuccess: 'Žiadosť bola úspešne zrušená!',
    cancelFailed: 'Nepodarilo sa zrušiť žiadosť',
    cancelAfterStart: 'Žiadosť už nie je možné zrušiť – dátum začiatku už nastal alebo prebehol.',
    cancelReason: 'Dôvod zrušenia',

    // Confirm dialogs
    confirmApprove: 'Naozaj chcete schváliť túto žiadosť?',
    confirmReject: 'Prosím uveďte dôvod zamietnutia:',

    // Reject modal
    rejectModalTitle: 'Dôvod zamietnutia',
    rejectModalPlaceholder: 'Prosím uveďte dôvod zamietnutia...',
    rejectModalCancel: 'Zrušiť',
    rejectModalSubmit: 'Zamietnuť',
    rejectModalError: 'Prosím uveďte dôvod zamietnutia',

    // Success/Error messages
    approveSuccess: 'Žiadosť bola úspešne schválená!',
    approveFailed: 'Nepodarilo sa schváliť žiadosť',
    approveError: 'Chyba pri schvaľovaní žiadosti',
    rejectSuccess: 'Žiadosť bola úspešne zamietnutá!',
    rejectFailed: 'Nepodarilo sa zamietnuť žiadosť',
    rejectError: 'Chyba pri zamietaní žiadosti',
    errorLoadingDashboard: 'Chyba pri načítaní nástenky',
    errorLoadingApprovals: 'Chyba pri načítaní schválení',
    errorLoadingRequests: 'Chyba pri načítaní žiadostí',
    errorLoadingHistory: 'Chyba pri načítaní histórie',
    errorLoadingCalendar: 'Chyba pri načítaní kalendára',

    // Team Calendar
    teamCalendarTitle: 'Teamový kalendár',
    teamCalendarSubtitle: 'Pozrite si kto má voľno vo vybranom období',
    calendarToday: 'Dnes',
    calendarTomorrow: 'Zajtra',
    calendarDayAfter: 'Pozajtra',
    calendarNoOneOff: 'Nikto nemá voľno',
    loadingCalendar: 'Načítavam kalendár...',
    labelDate: 'Dátum',
    calendarDateFrom: 'Od',
    calendarDateTo: 'Do',
    calendarApplyFilter: 'Zobraziť',
    calendarQuickToday: 'Dnes',
    calendarQuickWeek: 'Tento týždeň',
    calendarQuickMonth: 'Tento mesiac',

    // Sick Notes page (Paragrafy & OČR)
    sickNotesTitle: 'Paragrafy & OČR',
    sickNotesSubtitle: 'Nahrajte a spravujte vaše doklady paragrafov a OČR',
    sickNotesUploadTitle: 'Nahrať nový doklad',
    sickNotesListTitle: 'Moje doklady',
    sickNotesLabelDocType: 'Typ dokladu',
    sickNotesDocTypeParagraph: 'Paragraf',
    sickNotesDocTypeOcr: 'OČR',
    sickNotesLabelTitle: 'Názov',
    sickNotesPlaceholderTitle: 'Napr. Paragraf - chrípka',
    sickNotesLabelDoctor: 'Lekár',
    sickNotesPlaceholderDoctor: 'Napr. MUDr. Novák',
    sickNotesLabelDiagnosis: 'Diagnóza',
    sickNotesPlaceholderDiagnosis: 'Napr. Akútna respiračná infekcia',
    sickNotesLabelDateFrom: 'Dátum od',
    sickNotesLabelDateTo: 'Dátum do',
    sickNotesLabelFile: 'Doklad',
    sickNotesFileHint: 'PDF, JPG, PNG, HEIC (max 10MB)',
    sickNotesBtnSubmit: 'Nahrať doklad',
    sickNotesBtnSubmitting: 'Nahrávam...',
    sickNotesEmpty: 'Neboli nájdené žiadne doklady',
    sickNotesLoading: 'Načítavam doklady...',
    sickNotesSuccess: 'Doklad bol úspešne nahraný!',
    sickNotesError: 'Chyba pri nahrávaní dokladu',
    sickNotesDownload: 'Stiahnuť',
    sickNotesStatus: 'Stav',
    sickNotesStatusActive: 'Aktívna',
    sickNotesStatusCompleted: 'Ukončená',
    sickNotesNoNotes: 'Neboli nájdené žiadne doklady',
    sickNotesErrorLoading: 'Chyba pri načítaní dokladov',
    sickNotesErrorSubmit: 'Chyba pri vytváraní dokladu',
    sickNotesColTitle: 'Názov',
    sickNotesColFrom: 'Od',
    sickNotesColTo: 'Do',
    sickNotesColDoctor: 'Lekár',
    sickNotesColFile: 'Doklad',
    sickNotesHelperFile: 'Max 10MB. Podporované: PDF, JPG, PNG, HEIC, WebP',
    sickNotesViewDoc: 'Zobraziť doklad',
    sickNotesNoFile: 'Bez dokladu',
    sickNotesDays: 'dní',
    sickNotesHours: 'hodín',
    sickNotesDate: 'Dátum',
    sickNotesClose: 'Zavrieť',

    // Half-day vacation
    halfDayLabel: 'Pol dňa',
    halfDayFullDay: 'Celý deň',
    halfDayHalfDay: 'Pol dňa (0,5)',
    halfDayHelperText: 'Vyberte ak chcete požiadať iba o pol dňa voľna',

    // Selected days validation
    selectedDays: 'Vybrané pracovné dni',
    notEnoughDaysWarning: 'Nedostatok dní! Vybrali ste {selected} dní, ale zostáva vám len {remaining} dní.',
    dateRangeError: 'Dátum od musí byť pred dátumom do',

    // Required field
    required: '*',

    // Out of Office widget
    dashOutOfOfficeTitle: 'Dnes mimo kancelárie',
    dashOooNobody: 'Dnes sú všetci v kancelárii!',
    dashOooVacation: 'Dovolenka',
    dashOooSickLeave: 'PN',
    dashOooParagraph: 'Paragraf',
    dashOooOcr: 'OČR'
  }
};

// Current language (default: English)
let currentLang = localStorage.getItem('appLanguage') || 'en';

// Get translation
function t(key) {
  return translations[currentLang][key] || key;
}

// Get current language
function getCurrentLang() {
  return currentLang;
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
    // Re-apply badge count after nav rebuild
    if (typeof updateNavigationBadge === 'function') {
      updateNavigationBadge();
    }
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
