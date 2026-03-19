/**
 * ETILOG Portal - Internationalization (i18n)
 * Supports SK (Slovak) and EN (English)
 */

const portalTranslations = {
  sk: {
    // Sidebar nav
    navMain: 'Hlavné menu',
    navDashboard: 'Dashboard',
    navMyQuotas: 'Moje kvóty',
    navMySickNotes: 'Paragrafy & OČR',
    navMyRequests: 'Moje žiadosti',
    navMyApprovals: 'Moje schválenia',
    navAdmin: 'Administrácia',
    navAdminDashboard: 'Admin Dashboard',
    navEmployees: 'Zamestnanci',
    navQuotas: 'Kvóty',
    navAllSickNotes: 'Všetky paragrafy & OČR',
    navAllTickets: 'Všetky tikety',

    // User section
    userLoading: 'Načítavam...',
    btnLogout: 'Odhlásiť sa',

    // Common
    days: 'dni',
    yes: 'Áno',
    no: 'Nie',
    save: 'Uložiť',
    cancel: 'Zrušiť',
    edit: 'Upraviť',
    delete: 'Vymazať',
    upload: 'Nahrať',
    close: 'Zavrieť',
    download: 'Stiahnuť',
    noFile: 'Žiadny',
    none: '-',
    reason: 'Dôvod',
    loading: 'Načítavam...',

    // Errors
    profileLoadFailed: 'Nepodarilo sa načítať profil. Skúste sa znovu prihlásiť.',
    logoutRetry: 'Odhlásiť sa a skúsiť znova',
    accessDenied: 'Prístup zamietnutý',
    pageNotFound: 'Stránka sa nenašla',
    pageLoadError: 'Chyba pri načítaní stránky',
    changeFailed: 'Zmena zlyhala',
    saveFailed: 'Uloženie zlyhalo',
    uploadFailed: 'Upload zlyhal',
    deleteFailed: 'Vymazanie zlyhalo',
    fileNotFound: 'Súbor sa nenašiel',
    downloadError: 'Chyba pri sťahovaní',
    fileLoadError: 'Chyba pri načítaní súboru',
    previewNotAvailable: 'Náhľad nie je dostupný pre tento typ súboru.',
    downloadFile: 'Stiahnuť súbor',
    attachments: 'Prílohy',
    attachmentsOptional: 'Prílohy (voliteľné)',
    attachmentsHelper: 'Povolené: JPG, JPEG, PNG, PDF, DOCX, XLSX (max 10MB)',
    viewAttachments: 'Zobraziť prílohy',
    noAttachments: 'Žiadne prílohy',

    // Ticket types
    typeVacation: 'Dovolenka',
    typeSickLeave: 'PN',
    typePurchase: 'Nákup',
    typeExpense: 'Výdavok',
    typeHr: 'HR',
    typeOther: 'Iné',

    // Ticket statuses
    statusPending: 'Čakajúca',
    statusApproved: 'Schválená',
    statusRejected: 'Zamietnutá',
    statusCancelled: 'Zrušená',

    // Dashboard
    dashboardTitle: 'Dashboard',
    dashboardWelcome: 'Vitajte',
    vacationRemaining: 'Zostatok dovolenky',
    sickDaysRemaining: 'Zostatok zdrav. voľna',
    paragraphRemaining: 'Zostatok paragrafov',
    ocrRemaining: 'Zostatok OČR',
    approvedRequests: 'Schválené žiadosti',
    pendingRequests: 'Čakajúce žiadosti',
    myQuotasYear: 'Moje kvóty',
    vacation: 'Dovolenka',
    sickLeave: 'Zdravotné voľno',
    recentRequests: 'Posledné žiadosti',
    colName: 'Názov',
    colType: 'Typ',
    colStatus: 'Status',
    colDate: 'Dátum',
    noRequests: 'Žiadne žiadosti',

    // My Quotas
    myQuotasTitle: 'Moje kvóty',
    myQuotasDesc: 'Prehľad dovolenky a zdravotného voľna pre rok',
    quotaTotal: 'Celkom',
    quotaUsed: 'Vyčerpané',
    quotaRemaining: 'Zostatok',
    quotaEntitlement: 'Nárok',
    holidaysSR: 'Sviatky SR',
    holidayColDate: 'Dátum',
    holidayColName: 'Názov',

    // My Sick Notes (Paragrafy & OČR)
    mySickNotesTitle: 'Paragrafy & OČR',
    mySickNotesDesc: 'Evidencia paragrafov a OČR dokladov',
    newSickNote: '+ Nový doklad',
    sickNoteColName: 'Názov',
    sickNoteColFrom: 'Dátum od',
    sickNoteColTo: 'Dátum do',
    sickNoteColDoctor: 'Lekár',
    sickNoteColFile: 'Súbor',
    sickNoteColStatus: 'Status',
    noSickNotes: 'Žiadne doklady',

    // New Sick Note Modal (Paragrafy & OČR)
    newSickNoteTitle: 'Nový doklad',
    sickNoteFieldDocType: 'Typ dokladu *',
    sickNoteDocTypeParagraph: 'Paragraf',
    sickNoteDocTypeOcr: 'OČR',
    sickNoteFieldTitle: 'Názov *',
    sickNoteFieldTitlePlaceholder: 'napr. Paragraf - chrípka',
    sickNoteFieldDateFrom: 'Dátum od *',
    sickNoteFieldDateTo: 'Dátum do *',
    sickNoteFieldDoctor: 'Meno lekára',
    sickNoteFieldDoctorPlaceholder: 'MUDr. ...',
    sickNoteFieldDiagnosis: 'Diagnóza',
    sickNoteFieldDiagnosisPlaceholder: 'Voliteľné',
    sickNoteFieldDescription: 'Popis',
    sickNoteFieldDescriptionPlaceholder: 'Doplňujúce informácie...',
    sickNoteFieldFile: 'Súbor (PDF, JPG, PNG - max 10MB)',
    sickNoteCreated: 'Doklad bol vytvorený',
    sickNoteDeleted: 'Doklad bol vymazaný',
    sickNoteDeleteConfirm: 'Naozaj chcete vymazať tento doklad?',

    // Upload Modal
    uploadTitle: 'Nahrať súbor k dokladu',
    uploadFileLabel: 'Súbor (PDF, JPG, PNG - max 10MB)',
    uploadDropzone: 'Kliknite pre výber súboru alebo ho sem pretiahnite',
    uploadDropzoneFormats: 'PDF, JPG, PNG',
    uploadDropzoneSize: 'do 10MB',
    uploadSelectFile: 'Vyberte súbor',
    uploadSuccess: 'Súbor bol nahraný',

    // My Requests
    myRequestsTitle: 'Moje žiadosti',
    myRequestsDesc: 'Všetky moje tikety a schvaľovanie',
    newRequest: '+ Nová žiadosť',
    newRequestTitle: 'Nová žiadosť',
    reqFieldTitle: 'Názov žiadosti *',
    reqFieldTitlePlaceholder: 'napr. Dovolenka - júl 2026',
    reqFieldDescription: 'Popis *',
    reqFieldDescPlaceholder: 'Popíšte dôvod žiadosti...',
    reqFieldType: 'Typ žiadosti *',
    reqFieldSelectType: '-- Vyberte typ --',
    reqFieldPriority: 'Priorita *',
    reqFieldSelectPriority: '-- Vyberte prioritu --',
    reqPriorityLow: 'Nízka',
    reqPriorityMedium: 'Stredná',
    reqPriorityHigh: 'Vysoká',
    reqPriorityUrgent: 'Urgentná',
    reqFieldApprover: 'Schvaľovateľ *',
    reqFieldSelectApprover: '-- Vyberte schvaľovateľa --',
    reqFieldStartDate: 'Dátum od',
    reqFieldEndDate: 'Dátum do',
    selectedDays: 'Vybrané pracovné dni',
    dateRangeError: 'Dátum od musí byť pred dátumom do',
    notEnoughDaysWarning: 'Nedostatok dní! Vybrali ste {selected} dní, ale zostáva vám len {remaining} dní dovolenky.',
    reqCreated: 'Žiadosť bola vytvorená',
    reqCreateError: 'Chyba pri vytváraní žiadosti',
    filterAllStatuses: 'Všetky statusy',
    filterPending: 'Čakajúce',
    filterApproved: 'Schválené',
    filterRejected: 'Zamietnuté',
    colApprover: 'Schvaľovateľ',
    colAttachments: 'Prílohy',
    noTickets: 'Žiadne tikety',

    // My Approvals
    myApprovalsTitle: 'Moje schválenia',
    myApprovalsDesc: 'Žiadosti čakajúce na vaše schválenie a história rozhodnutí',
    colDecision: 'Rozhodnutie',
    colDecisionDate: 'Dátum rozhodnutia',
    tabPendingApprovals: 'Čakajúce',
    tabApprovalHistory: 'História',
    pendingApprovalsCount: 'čakajúcich',
    noPendingApprovals: 'Žiadne čakajúce žiadosti',
    noApprovalHistory: 'Žiadna história schválení',
    btnApprove: 'Schváliť',
    btnReject: 'Zamietnuť',
    approveConfirm: 'Naozaj chcete schváliť túto žiadosť?',
    approveSuccess: 'Žiadosť bola schválená',
    approveFailed: 'Chyba pri schvaľovaní',
    rejectModalTitle: 'Dôvod zamietnutia',
    rejectModalPlaceholder: 'Uveďte dôvod zamietnutia...',
    rejectModalSubmit: 'Zamietnuť',
    rejectSuccess: 'Žiadosť bola zamietnutá',
    rejectFailed: 'Chyba pri zamietnutí',
    rejectReasonRequired: 'Dôvod zamietnutia je povinný',
    btnCancelTicket: 'Zrušiť žiadosť',
    cancelModalTitle: 'Zrušiť žiadosť',
    cancelModalDesc: 'Naozaj chcete zrušiť túto žiadosť? Ak bola schválená, kvóta bude vrátená. Schvaľovateľ bude o zrušení informovaný.',
    cancelReasonLabel: 'Dôvod zrušenia',
    cancelReasonPlaceholder: 'Napíšte dôvod prečo žiadosť rušíte...',
    cancelReasonRequired: 'Dôvod zrušenia je povinný',
    cancelSuccess: 'Žiadosť bola úspešne zrušená',
    cancelFailed: 'Chyba pri rušení žiadosti',
    cancelReason: 'Dôvod zrušenia',
    colCreatedBy: 'Žiadateľ',
    colPriority: 'Priorita',
    colDates: 'Dátumy',
    filterYear: 'Rok',
    filterEmployee: 'Zamestnanec',
    filterSearch: 'Hľadať...',
    filterAllTypes: 'Všetky typy',
    filterAllYears: 'Všetky roky',
    filterAllEmployees: 'Všetci zamestnanci',

    // Admin Dashboard
    adminDashboardTitle: 'Admin Dashboard',
    adminDashboardDesc: 'Prehľad systému pre rok',
    totalEmployees: 'Zamestnancov',
    pendingTickets: 'Čakajúce tikety',
    approvedTickets: 'Schválené tikety',
    rejectedTickets: 'Zamietnuté tikety',
    approvedVacations: 'Schválené dovolenky',
    approvedSickLeaves: 'Schválené PN-ky',
    totalSickNotes: 'Doklady celkom',
    totalTickets: 'Tikety celkom',

    // Admin Employees
    employeesTitle: 'Zamestnanci',
    employeesDesc: 'Správa rolí a kvót zamestnancov',
    initQuotas: 'Inicializovať kvóty',
    colEmail: 'Email',
    colRole: 'Rola',
    colVacation: 'Dovolenka',
    colSickDays: 'Zdrav. voľno',
    colParagraph: 'Paragraf',
    colOcr: 'OČR',
    colActions: 'Akcie',
    colVisibility: 'Viditeľnosť',
    visibleLabel: 'Viditeľný',
    hiddenLabel: 'Skrytý',
    hideUserTitle: 'Skryť používateľa',
    showUserTitle: 'Zobraziť používateľa',
    hideUserConfirm: 'Skryť tohto používateľa zo zoznamu schvaľovateľov?',
    showUserConfirm: 'Zobraziť tohto používateľa v zozname schvaľovateľov?',
    userHidden: 'Používateľ skrytý zo zoznamu',
    userVisible: 'Používateľ zobrazený v zozname',
    changeRoleConfirm: 'Zmeniť rolu na',
    roleChanged: 'Rola zmenená na',
    changeRoleTitle: 'Zmeniť rolu',
    editQuotaTitle: 'Upraviť kvótu',
    editQuota: 'Upraviť kvóty',
    unlicensedUsersTitle: 'Používatelia bez licencie',
    unlicensedUsersDesc: 'Nasledujúci používatelia nemajú pridelenú Microsoft licenciu a preto sa nezobrazujú v zozname zamestnancov. Pre ich zahrnutie im musíte prideliť licenciu v Azure AD.',

    // Admin Quota Modal
    quotaModalTitle: 'Kvóty',
    quotaFieldVacation: 'Dovolenka',
    quotaFieldSickDays: 'Zdravotné voľno (dni)',
    quotaFieldParagraph: 'Paragraf',
    quotaFieldOcr: 'OČR',
    quotaNarok: 'Nárok',
    quotaZostatok: 'Zostatok',
    quotaSaved: 'Kvóta uložená',
    quotasInitialized: 'Inicializované pre',
    quotasInitConfirm: 'Inicializovať kvóty pre všetkých zamestnancov na rok',
    quotasAllAlreadyInit: 'Všetci zamestnanci už majú kvóty nastavené',
    quotasAllExist: 'všetci už majú kvóty',
    employees: 'zamestnancov',

    // Admin Quotas
    adminQuotasTitle: 'Kvóty',
    adminQuotasDesc: 'Prehľad kvót všetkých zamestnancov',
    quotaSettings: 'Nastavenia kvót',
    quotaSettingsYear: 'Rok',
    quotaSettingsDefaultVacation: 'Predvolená dovolenka (dni)',
    quotaSettingsDefaultSick: 'Predvolené zdrav. voľno',
    quotaSettingsDefaultParagraph: 'Predvolené paragrafy',
    quotaSettingsDefaultOcr: 'Predvolené OČR',
    quotaSettingsCarryOver: 'Prenos zostatku',
    quotaSettingsCarryOverMax: 'max',
    quotaSettingsSaved: 'Nastavenia uložené',
    employeeQuotasYear: 'Kvóty zamestnancov',
    colEmployee: 'Zamestnanec',
    colVacTotal: 'Dovolenka celkom',
    colVacUsed: 'Dovolenka využitá',
    colBalance: 'Zostatok',
    colSickTotal: 'Zdrav. voľno celkom',
    colSickUsed: 'Zdrav. voľno využité',
    colParagraphTotal: 'Paragraf celkom',
    colParagraphUsed: 'Paragraf využité',
    colOcrTotal: 'OČR celkom',
    colOcrUsed: 'OČR využité',

    // Admin Sick Notes
    allSickNotesTitle: 'Všetky paragrafy & OČR',
    allSickNotesDesc: 'Evidencia paragrafov a OČR všetkých zamestnancov',
    colDocType: 'Typ dokladu',
    colEmployeeName: 'Zamestnanec',
    colDocument: 'Doklad',
    employeeQuotasSection: 'Kvóty zamestnancov',
    employeeQuotasSectionDesc: 'Prehľad a úprava zostávajúcich dní paragrafov a OČR',
    colParagraphRemaining: 'Paragraf zostatok',
    colOcrRemaining: 'OČR zostatok',
    editParagraphQuotaTitle: 'Upraviť kvóty paragrafov a OČR',
    documentsSection: 'Doklady',

    // Admin Tickets
    allTicketsTitle: 'Všetky tikety',
    allTicketsDesc: 'Prehľad všetkých tiketov v systéme',
    filterAllTypes: 'Všetky typy',
    filterVacation: 'Dovolenka',
    filterSickLeave: 'PN / Práceneschopnosť',
    filterPurchase: 'Nákup',
    filterExpense: 'Výdavok',
    filterHr: 'HR',
    filterOther: 'Iné',
    bulkDelete: 'Zmazať označené',
    confirmBulkDelete: 'Naozaj chcete zmazať {count} tiketov?',
    bulkDeleteSuccess: 'Úspešne zmazaných {count} tiketov',
    bulkDeleteError: 'Chyba pri mazaní tiketov',
    confirmBulkDeleteSickNotes: 'Naozaj chcete zmazať {count} dokladov?',
    bulkDeleteSickNotesSuccess: 'Úspešne zmazaných {count} dokladov',
    bulkDeleteSickNotesError: 'Chyba pri mazaní dokladov',
    colTicketId: 'ID',
    colCreatedBy: 'Vytvoril',
    ticketDetailTitle: 'Detail tiketu',
    ticketDetailDescription: 'Popis',
    ticketDetailHalfDay: 'Polovičný deň',
    ticketDetailPriority: 'Priorita',
    ticketDetailCreatedAt: 'Vytvorený',
    ticketDetailUpdatedAt: 'Aktualizovaný',

    // Admin Ticket Types
    navTicketTypes: 'Typy tiketov',
    ticketTypesTitle: 'Typy tiketov',
    ticketTypesDesc: 'Správa typov tiketov zobrazovaných v Teams appke',
    ticketTypesAddNew: '+ Nový typ',
    ticketTypesColKey: 'Kľúč',
    ticketTypesColSk: 'Názov SK',
    ticketTypesColEn: 'Názov EN',
    ticketTypesColDates: 'Vyžaduje dátum',
    ticketTypesColActive: 'Aktívny',
    ticketTypesColOrder: 'Poradie',
    ticketTypesNewTitle: 'Nový typ tiketu',
    ticketTypesEditTitle: 'Upraviť typ tiketu',
    ticketTypesFieldKey: 'Kľúč (unikátny, napr. business-trip)',
    ticketTypesFieldSk: 'Názov v slovenčine',
    ticketTypesFieldEn: 'Názov v angličtine',
    ticketTypesFieldDates: 'Vyžaduje dátum od-do',
    ticketTypesFieldOrder: 'Poradie zobrazenia',
    ticketTypesCreated: 'Typ tiketu bol vytvorený',
    ticketTypesUpdated: 'Typ tiketu bol aktualizovaný',
    ticketTypesDeleted: 'Typ tiketu bol vymazaný',
    ticketTypesDeleteConfirm: 'Naozaj chcete vymazať tento typ tiketu?',
    ticketTypesCannotDelete: 'Nemožno vymazať',
    ticketTypesEmpty: 'Žiadne typy tiketov',
    ticketTypesToggleActive: 'Aktivovať/Deaktivovať',

    // Admin System Management
    navAdminSystem: 'Správa systému',
    adminSystemTitle: 'Správa systému',
    adminSystemDesc: 'Správa dát a zálohovanie databázy',
    dataStatistics: 'Štatistiky dát',
    tickets: 'Tikety',
    sickNotes: 'Doklady',
    quotas: 'Kvóty',
    users: 'Používatelia',
    dataManagement: 'Správa dát',
    dataManagementWarning: 'POZOR: Tieto akcie sú nevratné! Pred vymazaním dát odporúčame vytvoriť zálohu databázy.',
    deleteAllTickets: 'Vymazať všetky tikety',
    deleteAllSickNotes: 'Vymazať všetky doklady',
    deleteAllQuotas: 'Vymazať všetky kvóty',
    resetQuotasUsed: 'Resetovať využité dni',
    deleteAllTicketsConfirm: 'POZOR! Naozaj chcete vymazať VŠETKY tikety vrátane histórie a príloh? Táto akcia je NEVRATNÁ!',
    deleteAllSickNotesConfirm: 'POZOR! Naozaj chcete vymazať VŠETKY doklady (paragrafy a OČR)? Táto akcia je NEVRATNÁ!',
    deleteAllQuotasConfirm: 'POZOR! Naozaj chcete vymazať VŠETKY kvóty zamestnancov? Táto akcia je NEVRATNÁ!',
    resetQuotasUsedConfirm: 'Naozaj chcete resetovať využité dni kvót na 0 pre rok {year}?',
    deleteConfirmSecond: 'Ste si NAOZAJ istý? Kliknite OK pre potvrdenie vymazania.',
    databaseBackup: 'Záloha databázy',
    createBackup: 'Vytvoriť zálohu',
    creatingBackup: 'Vytváranie zálohy...',
    backupInfo: 'Zálohy sa automaticky vytvárajú každý deň cez CRON. Tu môžete vytvoriť manuálnu zálohu.',
    backupCreated: 'Záloha bola vytvorená',
    backupFailed: 'Záloha zlyhala',
    existingBackups: 'Existujúce zálohy',
    noBackups: 'Žiadne zálohy',
    colSize: 'Veľkosť',
    andMore: '... a ďalších {count} záloh',
  },

  en: {
    // Sidebar nav
    navMain: 'Main menu',
    navDashboard: 'Dashboard',
    navMyQuotas: 'My Quotas',
    navMySickNotes: 'Paragraphs & FMC',
    navMyRequests: 'My Requests',
    navMyApprovals: 'My Approvals',
    navAdmin: 'Administration',
    navAdminDashboard: 'Admin Dashboard',
    navEmployees: 'Employees',
    navQuotas: 'Quotas',
    navAllSickNotes: 'All Paragraphs & FMC',
    navAllTickets: 'All Tickets',

    // User section
    userLoading: 'Loading...',
    btnLogout: 'Sign out',

    // Common
    days: 'days',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    upload: 'Upload',
    close: 'Close',
    download: 'Download',
    noFile: 'None',
    none: '-',
    reason: 'Reason',
    loading: 'Loading...',

    // Errors
    profileLoadFailed: 'Failed to load profile. Please try logging in again.',
    logoutRetry: 'Sign out and try again',
    accessDenied: 'Access denied',
    pageNotFound: 'Page not found',
    pageLoadError: 'Error loading page',
    changeFailed: 'Change failed',
    saveFailed: 'Save failed',
    uploadFailed: 'Upload failed',
    deleteFailed: 'Delete failed',
    fileNotFound: 'File not found',
    downloadError: 'Download error',
    fileLoadError: 'Error loading file',
    previewNotAvailable: 'Preview is not available for this file type.',
    downloadFile: 'Download file',
    attachments: 'Attachments',
    attachmentsOptional: 'Attachments (optional)',
    attachmentsHelper: 'Allowed: JPG, JPEG, PNG, PDF, DOCX, XLSX (max 10MB)',
    viewAttachments: 'View attachments',
    noAttachments: 'No attachments',

    // Ticket types
    typeVacation: 'Vacation',
    typeSickLeave: 'Sick Leave',
    typePurchase: 'Purchase',
    typeExpense: 'Expense',
    typeHr: 'HR',
    typeOther: 'Other',

    // Ticket statuses
    statusPending: 'Pending',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    statusCancelled: 'Cancelled',

    // Dashboard
    dashboardTitle: 'Dashboard',
    dashboardWelcome: 'Welcome',
    vacationRemaining: 'Vacation remaining',
    sickDaysRemaining: 'Sick days remaining',
    paragraphRemaining: 'Paragraphs remaining',
    ocrRemaining: 'FMC remaining',
    approvedRequests: 'Approved requests',
    pendingRequests: 'Pending requests',
    myQuotasYear: 'My Quotas',
    vacation: 'Vacation',
    sickLeave: 'Sick leave',
    recentRequests: 'Recent requests',
    colName: 'Name',
    colType: 'Type',
    colStatus: 'Status',
    colDate: 'Date',
    noRequests: 'No requests',

    // My Quotas
    myQuotasTitle: 'My Quotas',
    myQuotasDesc: 'Vacation and sick leave overview for year',
    quotaTotal: 'Total',
    quotaUsed: 'Used',
    quotaRemaining: 'Remaining',
    quotaEntitlement: 'Entitlement',
    holidaysSR: 'Slovak Holidays',
    holidayColDate: 'Date',
    holidayColName: 'Name',

    // My Sick Notes (Paragraphs & FMC)
    mySickNotesTitle: 'Paragraphs & FMC',
    mySickNotesDesc: 'Paragraph and Family Member Care document records',
    newSickNote: '+ New Document',
    sickNoteColName: 'Title',
    sickNoteColFrom: 'Date from',
    sickNoteColTo: 'Date to',
    sickNoteColDoctor: 'Doctor',
    sickNoteColFile: 'File',
    sickNoteColStatus: 'Status',
    noSickNotes: 'No documents',

    // New Sick Note Modal (Paragraphs & FMC)
    newSickNoteTitle: 'New Document',
    sickNoteFieldDocType: 'Document Type *',
    sickNoteDocTypeParagraph: 'Paragraph',
    sickNoteDocTypeOcr: 'Family Member Care',
    sickNoteFieldTitle: 'Title *',
    sickNoteFieldTitlePlaceholder: 'e.g. Paragraph - flu',
    sickNoteFieldDateFrom: 'Date from *',
    sickNoteFieldDateTo: 'Date to *',
    sickNoteFieldDoctor: 'Doctor name',
    sickNoteFieldDoctorPlaceholder: 'Dr. ...',
    sickNoteFieldDiagnosis: 'Diagnosis',
    sickNoteFieldDiagnosisPlaceholder: 'Optional',
    sickNoteFieldDescription: 'Description',
    sickNoteFieldDescriptionPlaceholder: 'Additional information...',
    sickNoteFieldFile: 'File (PDF, JPG, PNG - max 10MB)',
    sickNoteCreated: 'Document created',
    sickNoteDeleted: 'Document deleted',
    sickNoteDeleteConfirm: 'Are you sure you want to delete this document?',

    // Upload Modal
    uploadTitle: 'Upload file to document',
    uploadFileLabel: 'File (PDF, JPG, PNG - max 10MB)',
    uploadDropzone: 'Click to select a file or drag it here',
    uploadDropzoneFormats: 'PDF, JPG, PNG',
    uploadDropzoneSize: 'up to 10MB',
    uploadSelectFile: 'Select a file',
    uploadSuccess: 'File uploaded',

    // My Requests
    myRequestsTitle: 'My Requests',
    myRequestsDesc: 'All my tickets and approvals',
    newRequest: '+ New Request',
    newRequestTitle: 'New Request',
    reqFieldTitle: 'Request Title *',
    reqFieldTitlePlaceholder: 'e.g. Vacation - July 2026',
    reqFieldDescription: 'Description *',
    reqFieldDescPlaceholder: 'Describe the reason for the request...',
    reqFieldType: 'Request Type *',
    reqFieldSelectType: '-- Select type --',
    reqFieldPriority: 'Priority *',
    reqFieldSelectPriority: '-- Select priority --',
    reqPriorityLow: 'Low',
    reqPriorityMedium: 'Medium',
    reqPriorityHigh: 'High',
    reqPriorityUrgent: 'Urgent',
    reqFieldApprover: 'Approver *',
    reqFieldSelectApprover: '-- Select approver --',
    reqFieldStartDate: 'Start Date',
    reqFieldEndDate: 'End Date',
    selectedDays: 'Selected working days',
    dateRangeError: 'Start date must be before end date',
    notEnoughDaysWarning: 'Not enough days! You selected {selected} days, but only {remaining} vacation days remaining.',
    reqCreated: 'Request created successfully',
    reqCreateError: 'Error creating request',
    filterAllStatuses: 'All statuses',
    filterPending: 'Pending',
    filterApproved: 'Approved',
    filterRejected: 'Rejected',
    colApprover: 'Approver',
    colAttachments: 'Attachments',
    noTickets: 'No tickets',

    // My Approvals
    myApprovalsTitle: 'My Approvals',
    myApprovalsDesc: 'Requests awaiting your approval and decision history',
    colDecision: 'Decision',
    colDecisionDate: 'Decision date',
    tabPendingApprovals: 'Pending',
    tabApprovalHistory: 'History',
    pendingApprovalsCount: 'pending',
    noPendingApprovals: 'No pending requests',
    noApprovalHistory: 'No approval history',
    btnApprove: 'Approve',
    btnReject: 'Reject',
    approveConfirm: 'Are you sure you want to approve this request?',
    approveSuccess: 'Request approved',
    approveFailed: 'Error approving request',
    rejectModalTitle: 'Rejection Reason',
    rejectModalPlaceholder: 'Please provide a reason for rejection...',
    rejectModalSubmit: 'Reject',
    rejectSuccess: 'Request rejected',
    rejectFailed: 'Error rejecting request',
    rejectReasonRequired: 'Rejection reason is required',
    btnCancelTicket: 'Cancel request',
    cancelModalTitle: 'Cancel request',
    cancelModalDesc: 'Are you sure you want to cancel this request? If it was approved, the quota will be returned. The approver will be notified.',
    cancelReasonLabel: 'Cancellation reason',
    cancelReasonPlaceholder: 'Enter the reason for cancellation...',
    cancelReasonRequired: 'Cancellation reason is required',
    cancelSuccess: 'Request cancelled successfully',
    cancelFailed: 'Error cancelling request',
    cancelReason: 'Cancellation reason',
    colCreatedBy: 'Requested by',
    colPriority: 'Priority',
    colDates: 'Dates',
    filterYear: 'Year',
    filterEmployee: 'Employee',
    filterSearch: 'Search...',
    filterAllTypes: 'All types',
    filterAllYears: 'All years',
    filterAllEmployees: 'All employees',

    // Admin Dashboard
    adminDashboardTitle: 'Admin Dashboard',
    adminDashboardDesc: 'System overview for year',
    totalEmployees: 'Employees',
    pendingTickets: 'Pending tickets',
    approvedTickets: 'Approved tickets',
    rejectedTickets: 'Rejected tickets',
    approvedVacations: 'Approved vacations',
    approvedSickLeaves: 'Approved sick leaves',
    totalSickNotes: 'Total documents',
    totalTickets: 'Total tickets',

    // Admin Employees
    employeesTitle: 'Employees',
    employeesDesc: 'Manage employee roles and quotas',
    initQuotas: 'Initialize quotas',
    colEmail: 'Email',
    colRole: 'Role',
    colVacation: 'Vacation',
    colSickDays: 'Sick days',
    colParagraph: 'Paragraph',
    colOcr: 'FMC',
    colActions: 'Actions',
    colVisibility: 'Visibility',
    visibleLabel: 'Visible',
    hiddenLabel: 'Hidden',
    hideUserTitle: 'Hide user',
    showUserTitle: 'Show user',
    hideUserConfirm: 'Hide this user from the approver list?',
    showUserConfirm: 'Show this user in the approver list?',
    userHidden: 'User hidden from list',
    userVisible: 'User visible in list',
    changeRoleConfirm: 'Change role to',
    roleChanged: 'Role changed to',
    changeRoleTitle: 'Change role',
    editQuotaTitle: 'Edit quota',
    editQuota: 'Edit quotas',
    unlicensedUsersTitle: 'Users without license',
    unlicensedUsersDesc: 'The following users do not have a Microsoft license assigned and therefore are not shown in the employee list. To include them, you need to assign a license in Azure AD.',

    // Admin Quota Modal
    quotaModalTitle: 'Quotas',
    quotaFieldVacation: 'Vacation',
    quotaFieldSickDays: 'Sick leave (days)',
    quotaFieldParagraph: 'Paragraph',
    quotaFieldOcr: 'FMC',
    quotaNarok: 'Entitlement',
    quotaZostatok: 'Balance',
    quotaSaved: 'Quota saved',
    quotasInitialized: 'Initialized for',
    quotasInitConfirm: 'Initialize quotas for all employees for year',
    quotasAllAlreadyInit: 'All employees already have quotas set up',
    quotasAllExist: 'all already have quotas',
    employees: 'employees',

    // Admin Quotas
    adminQuotasTitle: 'Quotas',
    adminQuotasDesc: 'Employee quotas overview',
    quotaSettings: 'Quota settings',
    quotaSettingsYear: 'Year',
    quotaSettingsDefaultVacation: 'Default vacation (days)',
    quotaSettingsDefaultSick: 'Default sick leave',
    quotaSettingsDefaultParagraph: 'Default paragraphs',
    quotaSettingsDefaultOcr: 'Default FMC',
    quotaSettingsCarryOver: 'Carry over',
    quotaSettingsCarryOverMax: 'max',
    quotaSettingsSaved: 'Settings saved',
    employeeQuotasYear: 'Employee quotas',
    colEmployee: 'Employee',
    colVacTotal: 'Vacation total',
    colVacUsed: 'Vacation used',
    colBalance: 'Balance',
    colSickTotal: 'Sick leave total',
    colSickUsed: 'Sick leave used',
    colParagraphTotal: 'Paragraph total',
    colParagraphUsed: 'Paragraph used',
    colOcrTotal: 'FMC total',
    colOcrUsed: 'FMC used',

    // Admin Sick Notes
    allSickNotesTitle: 'All Paragraphs & FMC',
    allSickNotesDesc: 'Paragraph and Family Member Care records of all employees',
    colDocType: 'Document type',
    colEmployeeName: 'Employee',
    colDocument: 'Document',
    employeeQuotasSection: 'Employee Quotas',
    employeeQuotasSectionDesc: 'View and edit remaining paragraph and FMC days',
    colParagraphRemaining: 'Paragraph remaining',
    colOcrRemaining: 'FMC remaining',
    editParagraphQuotaTitle: 'Edit Paragraph and FMC Quotas',
    documentsSection: 'Documents',

    // Admin Tickets
    allTicketsTitle: 'All Tickets',
    allTicketsDesc: 'Overview of all tickets in the system',
    filterAllTypes: 'All types',
    filterVacation: 'Vacation',
    filterSickLeave: 'Sick Leave',
    filterPurchase: 'Purchase',
    filterExpense: 'Expense',
    filterHr: 'HR',
    filterOther: 'Other',
    bulkDelete: 'Delete selected',
    confirmBulkDelete: 'Are you sure you want to delete {count} tickets?',
    bulkDeleteSuccess: 'Successfully deleted {count} tickets',
    bulkDeleteError: 'Error deleting tickets',
    confirmBulkDeleteSickNotes: 'Are you sure you want to delete {count} documents?',
    bulkDeleteSickNotesSuccess: 'Successfully deleted {count} documents',
    bulkDeleteSickNotesError: 'Error deleting documents',
    colTicketId: 'ID',
    colCreatedBy: 'Created by',
    ticketDetailTitle: 'Ticket Detail',
    ticketDetailDescription: 'Description',
    ticketDetailHalfDay: 'Half day',
    ticketDetailPriority: 'Priority',
    ticketDetailCreatedAt: 'Created',
    ticketDetailUpdatedAt: 'Updated',

    // Admin Ticket Types
    navTicketTypes: 'Ticket Types',
    ticketTypesTitle: 'Ticket Types',
    ticketTypesDesc: 'Manage ticket types displayed in the Teams app',
    ticketTypesAddNew: '+ New Type',
    ticketTypesColKey: 'Key',
    ticketTypesColSk: 'Label SK',
    ticketTypesColEn: 'Label EN',
    ticketTypesColDates: 'Requires dates',
    ticketTypesColActive: 'Active',
    ticketTypesColOrder: 'Order',
    ticketTypesNewTitle: 'New Ticket Type',
    ticketTypesEditTitle: 'Edit Ticket Type',
    ticketTypesFieldKey: 'Key (unique, e.g. business-trip)',
    ticketTypesFieldSk: 'Label in Slovak',
    ticketTypesFieldEn: 'Label in English',
    ticketTypesFieldDates: 'Requires date from-to',
    ticketTypesFieldOrder: 'Display order',
    ticketTypesCreated: 'Ticket type created',
    ticketTypesUpdated: 'Ticket type updated',
    ticketTypesDeleted: 'Ticket type deleted',
    ticketTypesDeleteConfirm: 'Are you sure you want to delete this ticket type?',
    ticketTypesCannotDelete: 'Cannot delete',
    ticketTypesEmpty: 'No ticket types',
    ticketTypesToggleActive: 'Activate/Deactivate',

    // Admin System Management
    navAdminSystem: 'System Management',
    adminSystemTitle: 'System Management',
    adminSystemDesc: 'Data management and database backup',
    dataStatistics: 'Data Statistics',
    tickets: 'Tickets',
    sickNotes: 'Documents',
    quotas: 'Quotas',
    users: 'Users',
    dataManagement: 'Data Management',
    dataManagementWarning: 'WARNING: These actions are irreversible! We recommend creating a backup before deleting data.',
    deleteAllTickets: 'Delete all tickets',
    deleteAllSickNotes: 'Delete all documents',
    deleteAllQuotas: 'Delete all quotas',
    resetQuotasUsed: 'Reset used days',
    deleteAllTicketsConfirm: 'WARNING! Are you sure you want to delete ALL tickets including history and attachments? This action is IRREVERSIBLE!',
    deleteAllSickNotesConfirm: 'WARNING! Are you sure you want to delete ALL documents (paragraphs and FMC)? This action is IRREVERSIBLE!',
    deleteAllQuotasConfirm: 'WARNING! Are you sure you want to delete ALL employee quotas? This action is IRREVERSIBLE!',
    resetQuotasUsedConfirm: 'Are you sure you want to reset used quota days to 0 for year {year}?',
    deleteConfirmSecond: 'Are you REALLY sure? Click OK to confirm deletion.',
    databaseBackup: 'Database Backup',
    createBackup: 'Create Backup',
    creatingBackup: 'Creating backup...',
    backupInfo: 'Backups are automatically created daily via CRON. Here you can create a manual backup.',
    backupCreated: 'Backup created',
    backupFailed: 'Backup failed',
    existingBackups: 'Existing Backups',
    noBackups: 'No backups',
    colSize: 'Size',
    andMore: '... and {count} more backups',
  }
};

// Current language - default SK
let portalLang = localStorage.getItem('etilog_portal_lang') || 'sk';

/**
 * Get translated string
 */
function pt(key) {
  return (portalTranslations[portalLang] && portalTranslations[portalLang][key]) ||
         (portalTranslations.sk[key]) ||
         key;
}

// Cache for ticket types loaded from API
let _portalTicketTypes = null;

/**
 * Load ticket types from API for translation
 */
async function loadPortalTicketTypes() {
  try {
    const response = await fetch('/api/ticket-types/active');
    if (response.ok) {
      const result = await response.json();
      _portalTicketTypes = result.data || [];
    }
  } catch (e) {
    console.warn('Could not load ticket types for translation');
  }
}

// Load on init
loadPortalTicketTypes();

/**
 * Translate ticket type from DB value
 */
function translateType(type) {
  // Try dynamic types first (from API)
  if (_portalTicketTypes) {
    const found = _portalTicketTypes.find(t => t.key === type);
    if (found) {
      return portalLang === 'sk' ? found.label_sk : found.label_en;
    }
  }
  // Fallback to hardcoded translations
  const map = {
    'vacation': pt('typeVacation'),
    'sick-leave': pt('typeSickLeave'),
    'purchase': pt('typePurchase'),
    'expense': pt('typeExpense'),
    'hr': pt('typeHr'),
    'other': pt('typeOther')
  };
  return map[type] || type;
}

/**
 * Translate ticket status from DB value
 */
function translateStatus(status) {
  const map = {
    'Pending': pt('statusPending'),
    'Approved': pt('statusApproved'),
    'Rejected': pt('statusRejected'),
    'Cancelled': pt('statusCancelled'),
    'active': pt('statusActive') || 'Active',
    'archived': pt('statusArchived') || 'Archived'
  };
  return map[status] || status;
}

/**
 * Switch portal language and re-render
 */
function switchPortalLang(lang) {
  portalLang = lang;
  localStorage.setItem('etilog_portal_lang', lang);

  // Update switcher buttons
  document.querySelectorAll('.portal-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Update sidebar texts
  updateSidebarLanguage();

  // Reload ticket type translations
  loadPortalTicketTypes();

  // Re-render current page
  if (typeof renderPage === 'function' && currentPage) {
    renderPage(currentPage);
  }
}

/**
 * Update sidebar navigation text based on language
 */
function updateSidebarLanguage() {
  const mappings = {
    'dashboard': pt('navDashboard'),
    'my-quotas': pt('navMyQuotas'),
    'my-sick-notes': pt('navMySickNotes'),
    'my-requests': pt('navMyRequests'),
    'my-approvals': pt('navMyApprovals'),
    'admin-dashboard': pt('navAdminDashboard'),
    'admin-employees': pt('navEmployees'),
    'admin-quotas': pt('navQuotas'),
    'admin-sick-notes': pt('navAllSickNotes'),
    'admin-tickets': pt('navAllTickets'),
    'admin-ticket-types': pt('navTicketTypes'),
    'admin-system': pt('navAdminSystem')
  };

  document.querySelectorAll('.sidebar-link').forEach(link => {
    const page = link.dataset.page;
    if (mappings[page]) {
      const icon = link.querySelector('.nav-icon');
      const iconHtml = icon ? icon.outerHTML : '';
      link.innerHTML = iconHtml + ' ' + mappings[page];
    }
  });

  // Section titles
  const sections = document.querySelectorAll('.nav-section-title');
  if (sections[0]) sections[0].textContent = pt('navMain');
  if (sections[1]) sections[1].textContent = pt('navAdmin');
}
