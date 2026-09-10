import React from 'react';
import { Tabs } from 'expo-router';
import AppTabBar from '../../src/features/navigation/AppTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
    </Tabs>
  );
}
