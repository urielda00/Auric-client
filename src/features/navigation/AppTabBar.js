import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MiniPlayer from '../player/MiniPlayer';
import { useLayoutMetricsStore } from '../../stores/useLayoutMetricsStore';
import { colors } from '../../constants/theme';

/**
 * Custom bottom tab bar: Home + Search, with the persistent Mini Player rendered directly
 * above it (as the approved design specifies) rather than as a separate overlay.
 *
 * Reports its own total rendered height (Mini Player + tab row + safe area) so Home/Search
 * can size their scrollable content's bottom padding around it without hardcoding any of
 * those numbers — see `useTabBarBottomInset`.
 */
export default function AppTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const setTabBarHeight = useLayoutMetricsStore((s) => s.setTabBarHeight);
  const activeName = state.routeNames[state.index];

  const go = (name) => {
    if (activeName !== name) navigation.navigate(name);
  };

  return (
    <View onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}>
      <MiniPlayer />
      <BlurView intensity={20} tint="dark" style={[styles.bar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        <TabItem label="HOME" active={activeName === 'index'} onPress={() => go('index')}>
          {(color) => <View style={[styles.homeIcon, { borderColor: color }]} />}
        </TabItem>
        <TabItem label="SEARCH" active={activeName === 'search'} onPress={() => go('search')}>
          {(color) => (
            <View style={[styles.searchIcon, { borderColor: color }]}>
              <View style={[styles.searchHandle, { backgroundColor: color }]} />
            </View>
          )}
        </TabItem>
      </BlurView>
    </View>
  );
}

function TabItem({ label, active, onPress, children }) {
  const color = active ? colors.text : colors.iconIdle;
  return (
    <Pressable onPress={onPress} style={styles.item}>
      {children(color)}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(8,8,11,0.7)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
  },
  homeIcon: {
    width: 17,
    height: 15,
    borderWidth: 2,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  searchIcon: {
    width: 15,
    height: 15,
    borderWidth: 2,
    borderRadius: 8,
  },
  searchHandle: {
    position: 'absolute',
    right: -5,
    bottom: -4,
    width: 8,
    height: 2,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  label: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 9.5,
    letterSpacing: 1,
  },
});
