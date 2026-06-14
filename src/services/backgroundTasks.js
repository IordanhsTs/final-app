import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabase';

export const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Σφάλμα Background:", error);
    return;
  }
  if (data) {
    const { locations } = data;
    const location = locations[0];
    
    const currentDriverId = await AsyncStorage.getItem('driverId'); 
    
    if (currentDriverId && location) {
      await supabase
        .from('drivers')
        .update({ 
          latitude: location.coords.latitude, 
          longitude: location.coords.longitude 
        })
        .eq('id', currentDriverId);
    }
  }
});