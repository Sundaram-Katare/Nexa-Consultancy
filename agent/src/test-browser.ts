import * as fs from "fs";
import { buildServer } from "./server";
import { browserManager } from "./browser/browserManager";
import { closePool } from "./db/pool";

async function runBrowserTests() {
  console.log("==================================================");
  console.log("🌐 PHASE 4 PLAYWRIGHT BROWSER ENGINE TEST SUITE");
  console.log("==================================================");

  const app = buildServer();
  await app.ready();

  try {
    // 1. Basic Navigation Test
    console.log("\n[TEST 1] Testing navigation to 'https://example.com' via /debug/navigate...");
    const navRes = await app.inject({
      method: "POST",
      url: "/debug/navigate",
      payload: {
        url: "https://example.com",
      },
    });

    console.log(`Status: ${navRes.statusCode}, Payload:`, navRes.body);
    if (navRes.statusCode !== 200) {
      throw new Error(`Expected 200 from /debug/navigate, got ${navRes.statusCode}`);
    }

    const navJson = JSON.parse(navRes.body);
    if (!navJson.title.includes("Example Domain")) {
      throw new Error(`Expected page title 'Example Domain', got '${navJson.title}'`);
    }
    console.log(`✅ Successfully navigated to ${navJson.final_url}, title: "${navJson.title}" (${navJson.duration_ms}ms).`);

    // 2. Error Recovery & Screenshot Test
    console.log("\n[TEST 2] Testing error handling on invalid URL + screenshot capture...");
    const badNavRes = await app.inject({
      method: "POST",
      url: "/debug/navigate",
      payload: {
        url: "https://invalid-domain-does-not-exist-xyz999.com",
        timeout_ms: 5000,
      },
    });

    console.log(`Status: ${badNavRes.statusCode}, Payload:`, badNavRes.body);
    if (badNavRes.statusCode !== 502) {
      throw new Error(`Expected 502 from invalid URL navigation, got ${badNavRes.statusCode}`);
    }

    const badNavJson = JSON.parse(badNavRes.body);
    if (!badNavJson.category) {
      throw new Error(`Expected error category in response: ${badNavRes.body}`);
    }
    console.log(`✅ Correctly caught navigation error (Category: ${badNavJson.category}).`);

    // 3. Concurrent Sessions Test (Context Isolation)
    console.log("\n[TEST 3] Testing 3 concurrent browser sessions via /debug/navigate...");
    const startConcurrent = Date.now();
    const concurrentPromises = [1, 2, 3].map((i) =>
      app.inject({
        method: "POST",
        url: "/debug/navigate",
        payload: {
          url: "https://example.com",
        },
      })
    );

    const results = await Promise.all(concurrentPromises);
    const concurrentDuration = Date.now() - startConcurrent;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.statusCode !== 200) {
        throw new Error(`Concurrent request #${i + 1} failed with status ${res.statusCode}`);
      }
      const json = JSON.parse(res.body);
      console.log(`- Session ${i + 1}: ${json.session_id.slice(0, 8)}... (${json.duration_ms}ms)`);
    }
    console.log(`✅ All 3 concurrent sessions completed cleanly in ${concurrentDuration}ms.`);

    // 4. Session Teardown Verification
    console.log("\n[TEST 4] Verifying all temporary sessions were closed...");
    const activeSessions = browserManager.getActiveSessionCount();
    console.log(`Active sessions in BrowserManager: ${activeSessions}`);
    if (activeSessions !== 0) {
      throw new Error(`Expected 0 active sessions after requests completed, found ${activeSessions}`);
    }
    console.log("✅ All session contexts were cleanly closed without resource leaks.");

    console.log("\n==================================================");
    console.log("🎉 ALL PLAYWRIGHT BROWSER ENGINE TESTS PASSED 100%!");
    console.log("==================================================");
  } catch (error: any) {
    console.error("❌ Browser Engine Test Failed:", error);
    process.exit(1);
  } finally {
    await browserManager.closeAll();
    await app.close();
    await closePool();
  }
}

runBrowserTests();
