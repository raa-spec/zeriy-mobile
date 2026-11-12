import React, { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();

  useEffect(() => {
    try {
      WebBrowser.maybeCompleteAuthSession();
    } catch (e) {
      // ignore
    }

    const code = params.code || params.auth_code;

    // FIX 3: if the home screen is still mounted (app was in the background),
    // just go back to it. It already receives the code through its Linking
    // listener, so its WebView is not re-created.
    if (router.canGoBack()) {
      router.back();
      return;
    }

    // Cold start (app was closed): open home and pass the code along.
    router.replace({
      pathname: "/",
      params: code ? { code: String(code) } : {},
    });
  }, [params, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6C3CE9" />
      <Text style={styles.text}>Completing your Zeriy login...</Text>
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