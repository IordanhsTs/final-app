import { StyleSheet } from 'react-native';

export const Colors = {
  light: {
    background: '#E3F2FD', // Ένα πολύ απαλό και ξεκούραστο γαλάζιο
    card: '#FFFFFF',
    text: '#000000',
    subtitle: '#555555',
    border: '#DDDDDD',
    inputBg: '#F9F9F9',
    toggleBg: '#E0E0E0',
    commentBg: '#f5f5f5',
    acceptedBg: '#F0F8FF'
  },
  dark: {
    background: '#0F172A', // Ένα πολύ βαθύ, σκούρο μπλε/γκρι αντί για σκέτο μαύρο
    card: '#1E1E1E',
    text: '#FFFFFF',
    subtitle: '#AAAAAA',
    border: '#333333',
    inputBg: '#2C2C2C',
    toggleBg: '#333333',
    commentBg: '#222222',
    acceptedBg: '#1a2b3c'
  }
};

export const getStyles = (isDark) => {
  const theme = isDark ? Colors.dark : Colors.light;

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background, paddingTop: 40 },
    containerCenter: { flex: 1, backgroundColor: theme.background, justifyContent: 'center' },
    header: { flexDirection: 'row', padding: 15, backgroundColor: theme.card, justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: theme.border },
    title: { fontSize: 32, textAlign: 'center', marginBottom: 20, color: theme.text },
    
    roleToggle: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 20, backgroundColor: theme.toggleBg, borderRadius: 10, overflow: 'hidden' },
    toggleBtn: { flex: 1, padding: 15, alignItems: 'center' },
    toggleText: { fontSize: 16, color: theme.subtitle },
    toggleBtnActive: { backgroundColor: theme.card, borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 3 },
    toggleTextActive: { fontWeight: 'bold' },
    
    input: { margin: 20, padding: 15, backgroundColor: theme.card, borderRadius: 10, borderWidth: 1, borderColor: theme.border, color: theme.text },
    button: { margin: 20, padding: 15, backgroundColor: isDark ? '#444' : '#333', borderRadius: 10, alignItems: 'center' },
    buttonTextWhite: { color: '#FFF', fontWeight: 'bold' },
    
    storeName: { fontWeight: 'bold', color: '#E53935', fontSize: 18 },
    formCard: { backgroundColor: theme.card, margin: 10, padding: 15, borderRadius: 10 },
    
    inputSmall: { backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border, borderRadius: 5, padding: 10, marginBottom: 10, color: theme.text },
    paymentToggleContainer: { flexDirection: 'row', marginBottom: 10, gap: 10 },
    payBtn: { flex: 1, padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 5, alignItems: 'center', backgroundColor: theme.inputBg },
    payBtnActiveCash: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
    payBtnActiveCard: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
    payBtnText: { color: theme.subtitle, fontWeight: 'bold' },
    
    submitBtn: { backgroundColor: '#E53935', padding: 12, borderRadius: 5, alignItems: 'center' },
    
    orderCard: { 
      backgroundColor: isDark ? '#2C2C2C' : '#FFFFFF', 
      padding: 18, 
      marginHorizontal: 15, 
      marginVertical: 12, 
      borderRadius: 16, 
      elevation: 6, // Σκιά για Android
      shadowColor: '#000', // Σκιά για iOS
      shadowOffset: { width: 0, height: 4 }, 
      shadowOpacity: 0.12, 
      shadowRadius: 8,
      borderWidth: 1.5,
      borderColor: isDark ? '#444444' : '#E2E8F0'
    },
    orderAddress: { fontSize: 16, fontWeight: 'bold', marginBottom: 5, color: theme.text },
    commentText: { fontStyle: 'italic', color: theme.subtitle, marginTop: 5, backgroundColor: theme.commentBg, padding: 5, borderRadius: 5 },
    
    statusPending: { color: '#FFA000', fontWeight: 'bold', marginTop: 10 },
    acceptedContainer: { marginTop: 10, backgroundColor: theme.acceptedBg, padding: 10, borderRadius: 8 },
    statusAccepted: { color: '#208AEF', fontWeight: 'bold' },
    workloadText: { color: theme.subtitle, fontSize: 12, marginTop: 5 },
    
    mapBtn: { backgroundColor: '#4CAF50', padding: 8, borderRadius: 5, marginTop: 10, alignItems: 'center' },
    closeModalBtn: { backgroundColor: isDark ? '#222' : '#333', padding: 15, paddingTop: 40, alignItems: 'center' },
    logoutText: { color: 'red', fontWeight: 'bold' },
    driverName: { fontWeight: 'bold', color: '#208AEF' },
    
    tabContainer: { flexDirection: 'row', backgroundColor: theme.card, borderBottomWidth: 1, borderColor: theme.border },
    tab: { flex: 1, padding: 15, alignItems: 'center' },
    tabText: { color: theme.subtitle },
    activeTabText: { fontWeight: 'bold', color: '#208AEF' },
    
    acceptButton: { backgroundColor: '#208AEF', padding: 12, marginTop: 10, alignItems: 'center', borderRadius: 5 },
    completeButton: { backgroundColor: '#4CAF50', padding: 12, marginTop: 10, alignItems: 'center', borderRadius: 5 },

    // Menu & History Modal
    menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end' },
    menuContent: { width: 220, backgroundColor: theme.card, marginTop: 60, marginRight: 15, borderRadius: 12, padding: 10, elevation: 8, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.2, shadowRadius: 6 },
    menuItem: { paddingVertical: 18, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: theme.border },
    menuItemText: { fontSize: 17, color: theme.text, fontWeight: '700' },
    
    modalContainer: { flex: 1, backgroundColor: theme.background, paddingTop: 50, paddingHorizontal: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 24, fontWeight: '900', color: theme.text },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
    filterBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.inputBg, borderRadius: 20, borderWidth: 1, borderColor: theme.border },
    filterBtnActive: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
    filterBtnText: { color: theme.text, fontSize: 14, fontWeight: '600' },
    filterBtnTextActive: { color: '#FFF', fontWeight: '900' },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, gap: 10 },
    statBox: { flex: 1, backgroundColor: theme.card, padding: 15, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.border, elevation: 2 },
    statValue: { fontSize: 24, fontWeight: '900', color: '#208AEF', marginVertical: 5 },
    statLabel: { fontSize: 13, color: theme.subtitle, textAlign: 'center', fontWeight: '700' },
    tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
    tableCell: { color: theme.text, fontSize: 16, flex: 1 },
    tableCellBold: { color: theme.text, fontSize: 16, fontWeight: '900' },
    
    // Custom Alert Modal
    alertModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    alertModalContainer: { width: '80%', backgroundColor: theme.card, borderRadius: 16, padding: 20, elevation: 10, shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, borderWidth: 1, borderColor: theme.border },
    alertModalTitle: { fontSize: 20, fontWeight: '900', color: theme.text, marginBottom: 10, textAlign: 'center' },
    alertModalMessage: { fontSize: 16, color: theme.subtitle, textAlign: 'center', marginBottom: 20 },
    alertModalButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    alertModalButtonCancel: { flex: 1, paddingVertical: 12, backgroundColor: theme.inputBg, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
    alertModalButtonCancelText: { color: theme.text, fontWeight: 'bold', fontSize: 16 },
    alertModalButtonConfirm: { flex: 1, paddingVertical: 12, backgroundColor: '#208AEF', borderRadius: 8, alignItems: 'center' },
    alertModalButtonConfirmText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  });
};