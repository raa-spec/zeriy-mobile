import * as Location from "expo-location";
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";

import {
  StyleSheet,
  View,
  ActivityIndicator,
  StatusBar,
  Image,
  Text,
  Animated,
  BackHandler,
  Alert,
} from "react-native";

import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";

WebBrowser.maybeCompleteAuthSession();

// ==========================================
// CONFIGURATION
// ==========================================

const WEBSITE_URL = "https://zeriy.vercel.app";
const MOBILE_LOGIN_URL = `${WEBSITE_URL}/mobile-login`;

// FIX 1: build the callback URL with Linking.createURL so it is exactly
// "zeriy://auth/callback" (two slashes) and matches the server redirect.
const AUTH_CALLBACK_URL = Linking.createURL("auth/callback");

const PRIMARY_COLOR = "#6C3CE9";
const SPLASH_BACKGROUND = "#080824";

// Persistent across re-renders/navigations to prevent duplicate exchanges
const processedCodes = new Set();

// ==========================================
// EXTERNAL LINKS (Google Maps, tel:, etc.)
// ==========================================

// Google Maps web links (but NOT embedded map iframes)
const isMapsUrl = (url) =>
  (/^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(url) ||
    /^https?:\/\/maps\.google\.[a-z.]+/i.test(url) ||
    /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(url)) &&
  !/\/maps\/embed/i.test(url);

// Turns intent://maps.google.com/...#Intent;scheme=https;... into https://maps.google.com/...
const intentToHttps = (url) => {
  const m = url.match(/^intent:\/\/(.*?)#Intent;(.*)$/i);
  if (!m) return null;
  const scheme = (m[2].match(/scheme=([^;]+)/) || [])[1] || "https";
  return `${scheme}://${m[1]}`;
};

const openExternal = async (rawUrl) => {
  let url = rawUrl;

  if (/^intent:/i.test(url)) {
    url = intentToHttps(url) || url;
  }

  try {
    await Linking.openURL(url);
  } catch (e) {
    console.log("Could not open external URL:", url, e);
    Alert.alert("Unable to open", "No app was found to open this link.");
  }
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function HomeScreen() {
  const [showSplash, setShowSplash] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // FIX 2: control the WebView through state instead of injectJavaScript
  const [source, setSource] = useState({ uri: WEBSITE_URL });

  const routeParams = useLocalSearchParams();

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const webViewRef = useRef(null);

  const splashHidden = useRef(false);
  const splashTimer = useRef(null);
  const loginInProgress = useRef(false);
  const exchangeInProgress = useRef(false);
  const exchangeTimer = useRef(null);
  const exchangeNavigationSeen = useRef(false);

  // ==========================================
  // HIDE SPLASH
  // ==========================================

  const hideSplash = useCallback(() => {
    if (splashHidden.current) return;

    splashHidden.current = true;

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setShowSplash(false);
      }
    });
  }, [fadeAnim]);

  // ==========================================
  // SESSION EXCHANGE
  // ==========================================

  const performSessionExchange = useCallback((code) => {
    if (!code || processedCodes.has(code)) {
      return;
    }

    processedCodes.add(code);
    exchangeInProgress.current = true;
    exchangeNavigationSeen.current = false;
    setAuthLoading(true);

    const exchangeUrl =
      `${WEBSITE_URL}/api/mobile-auth/exchange?code=` +
      encodeURIComponent(code);

    if (exchangeTimer.current) {
      clearTimeout(exchangeTimer.current);
    }

    // Timeout protection
    exchangeTimer.current = setTimeout(() => {
      if (exchangeInProgress.current) {
        exchangeInProgress.current = false;
        exchangeNavigationSeen.current = false;
        setAuthLoading(false);

        Alert.alert(
          "Login failed",
          "Session exchange timed out. Please try again."
        );
      }
    }, 30000);

    // FIX 2: load the exchange URL by changing the WebView source.
    // The server sets the NextAuth session cookie inside the WebView
    // and redirects to the website.
    setSource({ uri: exchangeUrl });
  }, []);

  // Check incoming route params (e.g. from /auth/callback redirect)
  useEffect(() => {
    const code = routeParams?.code || routeParams?.auth_code;
    if (code) {
      performSessionExchange(String(code));
    }
  }, [routeParams, performSessionExchange]);

  // Check incoming deep links via Linking event
  useEffect(() => {
    const handleUrlEvent = (event) => {
      if (!event?.url) return;

      try {
        const parsed = Linking.parse(event.url);
        const code =
          parsed.queryParams?.code || parsed.queryParams?.auth_code;
        if (code) {
          performSessionExchange(String(code));
          return;
        }
      } catch (e) {
        // ignore parse error
      }

      const match = event.url.match(/[?&](?:code|auth_code)=([^&]+)/);
      if (match && match[1]) {
        performSessionExchange(decodeURIComponent(match[1]));
      }
    };

    const subscription = Linking.addEventListener("url", handleUrlEvent);

    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrlEvent({ url });
      }
    });

    return () => subscription.remove();
  }, [performSessionExchange]);

  // ==========================================
  // GOOGLE LOGIN
  // ==========================================

  const handleGoogleLogin = useCallback(async () => {
    if (loginInProgress.current || exchangeInProgress.current) {
      return;
    }

    loginInProgress.current = true;
    setAuthLoading(true);

    try {
      const result = await WebBrowser.openAuthSessionAsync(
        MOBILE_LOGIN_URL,
        AUTH_CALLBACK_URL
      );

      if (result.type === "success" && result.url) {
        let code = null;

        try {
          const parsed = Linking.parse(result.url);
          code = parsed.queryParams?.code || parsed.queryParams?.auth_code;
        } catch (e) {
          // ignore
        }

        if (!code) {
          const match = result.url.match(/[?&](?:code|auth_code)=([^&]+)/);
          if (match && match[1]) {
            code = decodeURIComponent(match[1]);
          }
        }

        if (code) {
          performSessionExchange(String(code));
        }
      }
    } catch (error) {
      console.error("Google login error:", error);

      if (!exchangeInProgress.current) {
        setAuthLoading(false);
        Alert.alert(
          "Login failed",
          error.message || "Unable to login."
        );
      }
    } finally {
      loginInProgress.current = false;

      // Keep auth overlay active if exchange was triggered
      setTimeout(() => {
        if (!exchangeInProgress.current) {
          setAuthLoading(false);
        }
      }, 1500);
    }
  }, [performSessionExchange]);

  // ==========================================
  // WEBSITE MESSAGE
  // ==========================================

  const handleWebViewMessage = useCallback(
    (event) => {
      if (event.nativeEvent.data === "ZERIY_GOOGLE_LOGIN") {
        handleGoogleLogin();
      }
    },
    [handleGoogleLogin]
  );

  // ==========================================
  // INTERCEPT WEBVIEW NAVIGATION TO GOOGLE
  // ==========================================

  const handleShouldStartLoadWithRequest = useCallback(
    (request) => {
      const { url } = request;

      // Embedded content (iframes) always stays inside the page
      if (request.isTopFrame === false) {
        return true;
      }

      // Always allow the mobile auth exchange endpoint
      if (url.includes("mobile-auth/exchange")) {
        return true;
      }

      // Non-web links: geo:, google.navigation:, intent:, tel:, mailto:, whatsapp: ...
      if (!/^https?:\/\//i.test(url)) {
        if (/^(about:|data:|blob:|javascript:)/i.test(url)) {
          return true;
        }
        openExternal(url);
        return false;
      }

      // Google Maps / Get Directions -> open the Google Maps app
      if (isMapsUrl(url)) {
        openExternal(url);
        return false;
      }

      // Intercept Google OAuth or mobile-login navigations inside the WebView
      if (
        url.includes("accounts.google.com") ||
        (url.startsWith(WEBSITE_URL) && url.includes("/mobile-login"))
      ) {
        handleGoogleLogin();
        return false;
      }

      return true;
    },
    [handleGoogleLogin]
  );

  // ==========================================
  // NAVIGATION STATE
  // ==========================================

  const handleNavigationChange = useCallback((navState) => {
    setCanGoBack(navState.canGoBack);

    const url = navState.url || "";
    const isExchangeUrl = url.includes("mobile-auth/exchange");

    if (exchangeInProgress.current && isExchangeUrl) {
      exchangeNavigationSeen.current = true;
    }

    // When the exchange finishes and redirects to the website
    if (
      exchangeInProgress.current &&
      (exchangeNavigationSeen.current || !isExchangeUrl) &&
      url.startsWith(WEBSITE_URL) &&
      !isExchangeUrl
    ) {
      exchangeInProgress.current = false;
      exchangeNavigationSeen.current = false;

      if (exchangeTimer.current) {
        clearTimeout(exchangeTimer.current);
        exchangeTimer.current = null;
      }

      setAuthLoading(false);
    }
  }, []);

  // ==========================================
  // WEBVIEW LOAD END
  // ==========================================

  const handleLoadEnd = useCallback(() => {
    if (splashTimer.current) {
      clearTimeout(splashTimer.current);
    }

    splashTimer.current = setTimeout(() => {
      hideSplash();
    }, 1000);
  }, [hideSplash]);

  // ==========================================
  // WEBVIEW ERROR
  // ==========================================

  const handleWebViewError = useCallback(
    (event) => {
      console.log("WebView error:", event.nativeEvent);

      if (exchangeInProgress.current) {
        exchangeInProgress.current = false;
        exchangeNavigationSeen.current = false;

        if (exchangeTimer.current) {
          clearTimeout(exchangeTimer.current);
          exchangeTimer.current = null;
        }

        setAuthLoading(false);

        Alert.alert(
          "Login failed",
          "Unable to establish your session."
        );
      } else {
        hideSplash();
      }
    },
    [hideSplash]
  );

  // ==========================================
  // HTTP ERROR
  // ==========================================

  const handleHttpError = useCallback((event) => {
    const { url, statusCode } = event.nativeEvent;

    console.log("HTTP error:", statusCode, url);

    if (
      exchangeInProgress.current &&
      url.includes("/api/mobile-auth/exchange")
    ) {
      exchangeInProgress.current = false;
      exchangeNavigationSeen.current = false;

      if (exchangeTimer.current) {
        clearTimeout(exchangeTimer.current);
        exchangeTimer.current = null;
      }

      setAuthLoading(false);

      Alert.alert(
        "Authentication error",
        `Server error: ${statusCode}`
      );
    }
  }, []);

  // ==========================================
  // ANDROID BACK BUTTON
  // ==========================================

  useEffect(() => {
    const backAction = () => {
      if (showSplash) return true;

      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }

      return false;
    };

    const handler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => handler.remove();
  }, [canGoBack, showSplash]);


  // ==========================================
  // LOCATION PERMISSION
  // ==========================================

  useEffect(() => {
    Location.requestForegroundPermissionsAsync().catch(() => { });
  }, []);

  // ==========================================
  // CLEANUP
  // ==========================================

  useEffect(() => {
    return () => {
      if (splashTimer.current) {
        clearTimeout(splashTimer.current);
      }

      if (exchangeTimer.current) {
        clearTimeout(exchangeTimer.current);
      }
    };
  }, []);

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <View style={styles.container}>
      <StatusBar
        backgroundColor={SPLASH_BACKGROUND}
        barStyle="light-content"
        translucent={false}
      />

      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <WebView
          ref={webViewRef}
          source={source}
          style={styles.webview}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          allowsBackForwardNavigationGestures={true}
          setSupportMultipleWindows={false}
          originWhitelist={["*"]}
          mixedContentMode="never"
          cacheEnabled={true}
          onMessage={handleWebViewMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          onNavigationStateChange={handleNavigationChange}
          onLoadEnd={handleLoadEnd}
          onError={handleWebViewError}
          onHttpError={handleHttpError}
          geolocationEnabled={true}
        />
      </SafeAreaView>

      {/* AUTH LOADING */}

      {authLoading && (
        <View style={styles.authOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />

          <Text style={styles.authText}>
            Completing your Zeriy login...
          </Text>
        </View>
      )}

      {/* SPLASH */}

      {showSplash && (
        <Animated.View
          style={[styles.splashScreen, { opacity: fadeAnim }]}
        >
          <Image
            source={require("@/assets/images/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={styles.tagline}>Made Simple Much Faster</Text>

          <ActivityIndicator
            size="small"
            color="#FFFFFF"
            style={styles.splashLoader}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SPLASH_BACKGROUND,
  },

  safeArea: {
    flex: 1,
    backgroundColor: PRIMARY_COLOR,
  },

  webview: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  splashScreen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: SPLASH_BACKGROUND,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    elevation: 9999,
  },

  logo: {
    width: 230,
    height: 230,
    borderRadius: 70,
    marginBottom: 20,
  },

  tagline: {
    fontSize: 19,
    fontWeight: "600",
    color: "#FFFFFF",
    letterSpacing: 1,
    textAlign: "center",
  },

  splashLoader: {
    marginTop: 25,
  },

  authOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8, 8, 36, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    elevation: 100,
  },

  authText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 12,
  },
});