import { StyleSheet } from 'react-native';

// ΠΑΛΕΤΑ ΤΟΥ MOCKUP (πελάτης, 31/07/2026) — δύο ξεχωριστές έννοιες:
//   • `surface` = ΣΚΟΥΡΕΣ επιφάνειες (header, μπάρες, μενού, modals, άδεια λίστα)
//   • `card`    = ΑΣΠΡΕΣ κάρτες περιεχομένου (οι παραγγελίες)
// Πριν ήταν και τα δύο `card`, γι' αυτό δεν μπορούσαν να διαφοροποιηθούν.
// Στο σκούρο θέμα το φόντο είναι ΒΑΘΥ ΜΠΛΕ (όχι μαύρο) και οι κάρτες άσπρες:
// αυτή είναι η βασική διαφορά από την προηγούμενη ταυτότητα «μαύρο + χρυσό γύρω».
export const Colors = {
  light: {
    background: '#F8F5F0', // Base (60%)
    surface: '#FFFFFF',
    card: '#FFFFFF',
    text: '#1E1A14', // Secondary (30%)
    subtitle: '#5C5248',
    border: '#E5DED4',
    inputBg: '#F4F0EB',
    toggleBg: '#EDE7DF',
    commentBg: '#F4F0EB',
    acceptedBg: '#F0FDF4',
    accent: '#C5A066', // Accent (10%)
  },
  dark: {
    background: '#0B1020', // Βαθύ navy αντί για μαύρο — πιο σκούρο (σημείο αναφοράς πελάτη 31/07/2026)
    surface: '#1B2338',    // Header / μπάρες / μενού / modals
    card: '#FFFFFF',       // Οι κάρτες παραγγελιών είναι ΑΣΠΡΕΣ
    text: '#F0EBE2',       // Κείμενο ΠΑΝΩ στο navy (όχι μέσα στην κάρτα)
    subtitle: '#93A0B8',
    border: '#2A3348',
    inputBg: '#1B2338',
    toggleBg: '#222C44',
    commentBg: '#F3F4F6',
    acceptedBg: 'rgba(34,197,94,0.08)',
    accent: '#D4A853', // Bright Gold Accent for dark mode
  }
};

// Χρώματα ΜΕΣΑ στην άσπρη κάρτα. Η κάρτα είναι άσπρη και στα δύο θέματα, οπότε
// το περιεχόμενό της ΔΕΝ εξαρτάται από το isDarkMode — γι' αυτό είναι σταθερές.
export const CardColors = {
  text: '#1A1D29',    // κύριο κείμενο (διεύθυνση παράδοσης)
  muted: '#6B7280',   // δευτερεύον (διεύθυνση καταστήματος, σχόλια)
  faint: '#9CA3AF',   // ετικέτες τμημάτων (ΠΑΡΑΔΟΣΗ / ΣΧΟΛΙΑ)
  divider: '#EDEFF3',
  chipBg: '#F3F4F6',
  chipText: '#6B7280',
  iconBg: '#F3F4F6',
  icon: '#374151',
  gold: '#C5A066',    // εικονίδιο καταστήματος
  numberBg: '#F5E9D3',
  numberText: '#8A6D2F',
  okBg: '#E7F8EF',
  okText: '#0E9F6E',
  warnBg: '#FEE9E9',
  warnText: '#DC2626',
  cardBg: '#E8F1FE',
  cardText: '#1D74D0',
};

export const getStyles = (isDark) => {
  const theme = isDark ? Colors.dark : Colors.light;

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background, paddingTop: 40 },
    containerCenter: { flex: 1, backgroundColor: theme.background, justifyContent: 'center' },
    header: { flexDirection: 'row', padding: 15, backgroundColor: theme.surface, justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: theme.border },
    title: { fontSize: 32, textAlign: 'center', marginBottom: 20, color: theme.text },
    
    roleToggle: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 20, backgroundColor: theme.toggleBg, borderRadius: 10, overflow: 'hidden' },
    toggleBtn: { flex: 1, padding: 15, alignItems: 'center' },
    toggleText: { fontSize: 16, color: theme.subtitle },
    toggleBtnActive: { backgroundColor: theme.surface, borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3 },
    toggleTextActive: { fontWeight: 'bold' },
    
    input: { margin: 20, padding: 15, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border, color: theme.text },
    button: { margin: 20, padding: 15, backgroundColor: isDark ? '#444' : '#333', borderRadius: 10, alignItems: 'center' },
    buttonTextWhite: { color: '#FFF', fontWeight: 'bold' },
    
    storeName: { fontWeight: 'bold', color: '#E53935', fontSize: 18 },
    formCard: { backgroundColor: theme.surface, margin: 10, padding: 15, borderRadius: 10 },
    
    inputSmall: { backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border, borderRadius: 5, padding: 10, marginBottom: 10, color: theme.text },
    paymentToggleContainer: { flexDirection: 'row', marginBottom: 10, gap: 10 },
    payBtn: { flex: 1, padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 5, alignItems: 'center', backgroundColor: theme.inputBg },
    payBtnActiveCash: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
    payBtnActiveCard: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
    payBtnText: { color: theme.subtitle, fontWeight: 'bold' },
    
    submitBtn: { backgroundColor: '#E53935', padding: 12, borderRadius: 5, alignItems: 'center' },
    
    // ΑΣΠΡΗ κάρτα πάνω στο navy — και στα δύο θέματα (mockup πελάτη 31/07/2026).
    // Το χρυσό περίγραμμα με το glow έφυγε: πάνω σε άσπρο δεν έχει τι να φωτίσει,
    // και η κάρτα ξεχωρίζει από μόνη της με τη σκιά.
    // Πιο σφιχτό padding/κενό μαζί με τη συγχώνευση «ΠΑΡΑΔΟΣΗ + ετικέτες» σε μία
    // γραμμή, ώστε να χωράνε περισσότερες παραγγελίες στην οθόνη.
    orderCard: {
      backgroundColor: theme.card,
      padding: 16,
      marginHorizontal: 16,
      marginVertical: 8,
      borderRadius: 22,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.12,
      shadowRadius: 10,
    },
    // (Τα παλιά tabActiveDarkDriver/tabActiveLightDriver αφαιρέθηκαν: η ενεργή
    //  καρτέλα ζωγραφίζεται πλέον με LinearGradient μέσα στο DriverDashboard.)
    // ΣΤΟ ΦΩΤΕΙΝΟ ΘΕΜΑ ΜΑΥΡΑ, όχι χρυσά (αίτημα πελάτη 04/08/2026): το χρυσό
    // κείμενο πάνω στη χρυσή σκίαση του gradient περιγράμματος δυσκόλευε την
    // ανάγνωση. Στο σκούρο θέμα το φόντο είναι navy, όχι χρυσό, οπότε εκεί
    // παραμένει χρυσό όπως ήταν.
    tabTextActiveDriver: { color: isDark ? theme.accent : theme.text, fontWeight: '900', letterSpacing: 1 },
    premiumButtonWrapper: { marginTop: 12, borderRadius: 12, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
    premiumButtonBackground: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    premiumButtonText: { fontSize: 14, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
    orderAddress: { fontSize: 16, fontWeight: 'bold', marginBottom: 5, color: theme.text },
    commentText: { fontStyle: 'italic', color: theme.subtitle, marginTop: 5, backgroundColor: theme.commentBg, padding: 5, borderRadius: 5 },
    
    statusPending: { color: '#FFA000', fontWeight: 'bold', marginTop: 10 },
    acceptedContainer: { marginTop: 10, backgroundColor: theme.acceptedBg, padding: 10, borderRadius: 8 },
    statusAccepted: { color: '#208AEF', fontWeight: 'bold' },
    workloadText: { color: theme.subtitle, fontSize: 12, marginTop: 5 },
    
    mapBtn: { backgroundColor: '#4CAF50', padding: 8, borderRadius: 5, marginTop: 10, alignItems: 'center' },
    closeModalBtn: { backgroundColor: isDark ? '#222' : '#333', padding: 15, paddingTop: 40, alignItems: 'center' },
    logoutText: { color: 'red', fontWeight: 'bold' },
    driverName: { fontWeight: 'bold', color: theme.accent },
    
    tabContainer: { flexDirection: 'row', backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.border },
    tab: { flex: 1, padding: 15, alignItems: 'center' },
    tabText: { color: theme.subtitle },
    activeTabText: { fontWeight: 'bold', color: theme.accent },
    
    acceptButton: { backgroundColor: theme.accent, padding: 12, marginTop: 10, alignItems: 'center', borderRadius: 5 },
    completeButton: { backgroundColor: '#4CAF50', padding: 12, marginTop: 10, alignItems: 'center', borderRadius: 5 },

    // Menu & History Modal
    // Το μενού ανοίγει ΑΡΙΣΤΕΡΑ, κάτω από το hamburger που μετακόμισε εκεί.
    menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-start' },
    menuContent: { width: 230, backgroundColor: theme.surface, marginTop: 60, marginLeft: 15, borderRadius: 12, padding: 10, elevation: 8, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.2, shadowRadius: 6 },
    menuItem: { paddingVertical: 18, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: theme.border },
    menuItemText: { fontSize: 17, color: theme.text, fontWeight: '700' },
    
    modalContainer: { flex: 1, backgroundColor: theme.background, paddingTop: 50, paddingHorizontal: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 24, fontWeight: '900', color: theme.text },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
    filterBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.inputBg, borderRadius: 20, borderWidth: 1, borderColor: theme.border },
    filterBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    filterBtnText: { color: theme.text, fontSize: 14, fontWeight: '600' },
    filterBtnTextActive: { color: '#FFF', fontWeight: '900' },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, gap: 10 },
    statBox: { flex: 1, backgroundColor: theme.surface, padding: 15, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.border, elevation: 2 },
    statValue: { fontSize: 24, fontWeight: '900', color: theme.accent, marginVertical: 5 },
    statLabel: { fontSize: 13, color: theme.subtitle, textAlign: 'center', fontWeight: '700' },
    tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
    tableCell: { color: theme.text, fontSize: 16, flex: 1 },
    tableCellBold: { color: theme.text, fontSize: 16, fontWeight: '900' },
    
    // Custom Alert Modal
    alertModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    alertModalContainer: { width: '80%', backgroundColor: theme.surface, borderRadius: 16, padding: 20, elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, borderWidth: 1, borderColor: theme.border },
    alertModalTitle: { fontSize: 20, fontWeight: '900', color: theme.text, marginBottom: 10, textAlign: 'center' },
    alertModalMessage: { fontSize: 16, color: theme.subtitle, textAlign: 'center', marginBottom: 20 },
    alertModalButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    alertModalButtonCancel: { flex: 1, paddingVertical: 12, backgroundColor: theme.inputBg, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
    alertModalButtonCancelText: { color: theme.text, fontWeight: 'bold', fontSize: 16 },
    alertModalButtonConfirm: { flex: 1, paddingVertical: 12, backgroundColor: theme.accent, borderRadius: 8, alignItems: 'center' },
    alertModalButtonConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

    // Extracted Store Dashboard Premium Styles
    headerPremium: { borderBottomWidth: 0, elevation: 5, shadowColor: '#000', shadowOffset: {width:0,height:4}, shadowOpacity: 0.1, shadowRadius: 5, backgroundColor: isDark ? '#0D0D0D' : '#FFFFFF', zIndex: 10 },
    headerLeft: { flex: 1, alignItems: 'flex-start' },
    headerBrandStore: { fontSize: 10, color: '#C5A066', fontWeight: 'bold', letterSpacing: 1 },
    headerNameStore: { color: isDark ? '#EAD7B1' : '#121212', fontSize: 18, fontWeight: 'bold' },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerIconBg: { backgroundColor: isDark ? '#151515' : '#F0F0F0', padding: 8, borderRadius: 20, borderWidth: isDark ? 1 : 0, borderColor: '#C5A066' },
    headerIcon: { fontSize: 18 },
    headerRight: { flex: 1, alignItems: 'flex-end' },
    headerMenuBg: { backgroundColor: isDark ? '#151515' : '#F0F0F0', padding: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: isDark ? 1 : 0, borderColor: '#C5A066' },
    headerMenuIcon: { fontSize: 16, color: isDark ? '#EAD7B1' : '#000', fontWeight: 'bold' },
    formCardPremium: { backgroundColor: isDark ? 'rgba(20, 20, 20, 0.9)' : theme.card, borderRadius: 22, elevation: 6, shadowColor: isDark ? '#C5A066' : '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.15, shadowRadius: 8, padding: 20, marginHorizontal: 16, marginTop: 16, borderWidth: isDark ? 1 : 0, borderColor: isDark ? '#C5A066' : 'transparent' },
    formGroupTop: { zIndex: 999, flex: 0, width: '100%' },
    placesContainer: { flex: 0, marginBottom: 12, zIndex: 999 },
    placesInput: { backgroundColor: theme.inputBg, borderWidth: 1, borderColor: isDark ? '#C5A066' : theme.border, color: theme.text, height: 50, borderRadius: 12, fontSize: 15, padding: 10 },
    placesListView: { position: 'absolute', top: 55, left: 0, right: 0, backgroundColor: isDark ? '#151515' : 'white', borderRadius: 12, elevation: 10, zIndex: 1000 },
    inputSmallPremium: { backgroundColor: theme.inputBg, borderWidth: 1, borderColor: isDark ? '#C5A066' : theme.border, color: theme.text, height: 50, borderRadius: 12, fontSize: 15, marginBottom: 12, padding: 10 },
    paymentTogglePremium: { flexDirection: 'row', marginBottom: 12, gap: 10 },
    payBtnPremium: { flex: 1, padding: 10, borderWidth: 1, borderColor: isDark ? '#C5A066' : theme.border, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#151515' : theme.inputBg },
    payBtnTextPremium: { color: theme.subtitle, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
    commentInputPremium: { backgroundColor: theme.inputBg, borderWidth: 1, borderColor: isDark ? '#C5A066' : theme.border, color: theme.text, height: 60, borderRadius: 12, textAlignVertical: 'top', fontSize: 15, marginBottom: 12, padding: 10 },
    submitBtnWrapper: { marginTop: 4, borderRadius: 12, shadowColor: isDark ? '#C5A066' : '#8E44AD', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5 },
    submitBtnBg: { backgroundColor: isDark ? '#C5A066' : '#8E44AD', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    submitBtnText: { color: isDark ? '#0D0D0D' : '#FFF', fontSize: 14, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
    activeOrdersSection: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: isDark ? '#0D0D0D' : '#F8F9FA', alignItems: 'center', borderTopWidth: 1, borderTopColor: isDark ? '#333' : '#E5E7EB' },
    activeOrdersTitle: { fontSize: 14, fontWeight: '900', color: isDark ? '#C5A066' : '#6B7280', textAlign: 'center', letterSpacing: 1.5 },
    orderCardHeaderStore: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: isDark ? '#C5A066' : '#E5E7EB', paddingBottom: 12 },
    orderAddressPremiumStore: { color: isDark ? '#EAD7B1' : '#1F2937', fontSize: 18, fontWeight: '900', flex: 1, marginRight: 8, letterSpacing: 0.5, marginBottom: 0 },
    timeBadgeStore: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, height: 32, justifyContent: 'center' },
    timeBadgeTextStore: { fontWeight: '900', fontSize: 13 },
    paymentRowStore: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    paymentRowStoreWithComments: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    paymentBadgeCash: { backgroundColor: '#10B981', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: '#10B981', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: {width: 0, height: 2} },
    paymentBadgeCard: { backgroundColor: '#208AEF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center', shadowColor: '#208AEF', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: {width: 0, height: 2} },
    paymentBadgeTextStore: { fontWeight: '900', color: '#FFF', fontSize: 12, textAlign: 'center', letterSpacing: 1 },
    commentTextPremiumStore: { fontSize: 14, padding: 8, backgroundColor: isDark ? '#151515' : '#F3F4F6', color: isDark ? '#A0A0A0' : '#4B5563', marginBottom: 8, borderRadius: 5, fontStyle: 'italic', borderWidth: 1, borderColor: isDark ? '#333' : 'transparent' },
    completedContainerStore: { backgroundColor: isDark ? 'rgba(6, 78, 59, 0.3)' : '#ECFDF5', borderColor: isDark ? '#C5A066' : '#10B981', borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 10 },
    completedTitleStore: { color: isDark ? '#C5A066' : '#10B981', fontWeight: '900', fontSize: 16 },
    completedSubtitleStore: { color: isDark ? '#EAD7B1' : '#047857', fontSize: 13, marginTop: 4, fontWeight: '600' },
    completedDriverStore: { color: isDark ? '#A0A0A0' : '#4B5563', marginTop: 10, fontSize: 14, fontWeight: '700' },
    pendingActionRowStore: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
    statusPendingPremiumStore: { color: '#FFA000', fontWeight: 'bold', fontSize: 15, marginTop: 0, flex: 1 },
    cancelBtnWrapperStore: { marginTop: 0, shadowColor: '#E53935', width: 110, borderRadius: 12, shadowOffset: {width:0, height:4}, shadowOpacity:0.4, shadowRadius:8, elevation:5 },
    cancelBtnBgStore: { backgroundColor: '#E53935', height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    cancelBtnTextStore: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    acceptedContainerPremiumStore: { backgroundColor: isDark ? 'rgba(26, 42, 74, 0.5)' : '#EFF6FF', borderColor: isDark ? '#C5A066' : '#3B82F6', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
    acceptedHeaderRowStore: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 },
    statusAcceptedPremiumStore: { color: isDark ? '#C5A066' : '#2563EB', fontSize: 15, fontWeight: '800' },
    acceptedTimeStore: { color: isDark ? '#A0A0A0' : '#6B7280', fontSize: 13, marginLeft: 5 },
    callBtnStore: { marginLeft: 'auto', padding: 6, backgroundColor: isDark ? '#151515' : '#DBEAFE', borderRadius: 12, borderWidth: 1, borderColor: isDark ? '#C5A066' : 'transparent' },
    callBtnIconStore: { fontSize: 18 },
    workloadTextPremiumStore: { marginTop: 0, color: isDark ? '#EAD7B1' : '#4B5563', fontSize: 12 },
    mapBtnWrapperStore: { marginTop: 12, shadowColor: theme.accent, borderRadius: 12, shadowOffset: {width:0,height:4}, shadowOpacity:0.4, shadowRadius:8, elevation:5 },
    mapBtnBgStore: { backgroundColor: theme.accent, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    mapBtnTextStore: { color: isDark ? '#0D0D0D' : '#1E1A14', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    mapModalContainer: { flex: 1 },
    mapView: { flex: 1 },
    historyCloseIcon: { fontSize: 26, color: isDark ? '#C5A066' : '#000' },
    historyFilterBtnSmall: { minWidth: 40, alignItems: 'center', justifyContent: 'center' },
    historyDateRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
    historyDateBtn: { flex: 1, marginBottom: 0, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: isDark ? '#C5A066' : theme.border, borderRadius: 12, padding: 10 },
    historyDateText: { color: theme.text, fontSize: 13 },
    historySectionTitle: { fontSize: 20, fontWeight: '900', color: theme.text, marginTop: 10, marginBottom: 10 },
    historyEmptyText: { color: isDark ? '#A0A0A0' : '#666', textAlign: 'center', marginTop: 20 },
  });
};