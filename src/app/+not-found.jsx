import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => {
      router.replace("/");
    }, 300);
    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C3CE9" />
      <Text style={styles.text}>Returning to Zeriy...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080824",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "#FFFFFF",
    marginTop: 16,
    fontSize: 15,
    fontWeight: "600",
  },
});
