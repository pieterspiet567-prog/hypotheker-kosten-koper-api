const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const URL = "https://rekentools.webbridge.nl/wijzeringeldzaken/kostenkoper.html";

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function woningValue(soortWoning) {
  return String(soortWoning).toLowerCase().includes("nieuw") ? "nieuw" : "oud";
}

app.post("/bereken", async (req, res) => {
  const {
    soortWoning,
    koopprijs,
    hypotheek,
    roerendeZaken,
    nhg,
    makelaar,
    makelaarscourtage,
    makelaarskosten,
    jaar,
    overdrachtsbelasting
  } = req.body;

  if (!soortWoning) return res.status(400).json({ error: "Soort woning ontbreekt" });
  if (!koopprijs) return res.status(400).json({ error: "Koopprijs ontbreekt" });
  if (!hypotheek) return res.status(400).json({ error: "Hypotheek ontbreekt" });
  if (roerendeZaken === undefined) return res.status(400).json({ error: "Roerende zaken ontbreekt" });
  if (!nhg) return res.status(400).json({ error: "NHG ontbreekt" });
  if (!makelaar) return res.status(400).json({ error: "Makelaar ontbreekt" });
  if (!jaar) return res.status(400).json({ error: "Jaar ontbreekt" });
  if (!overdrachtsbelasting) return res.status(400).json({ error: "Overdrachtsbelasting ontbreekt" });

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 }
    });

    await page.goto(URL, {
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(1500);

    const selects = page.locator("select:visible");
    const inputs = page.locator("input:visible");

    await selects.nth(0).selectOption(woningValue(soortWoning));

    await inputs.nth(0).fill(String(koopprijs));
    await inputs.nth(1).fill(String(hypotheek));
    await inputs.nth(2).fill(String(roerendeZaken));

    if (String(nhg).toLowerCase() === "ja") {
      await page.getByRole("button", { name: /^ja$/i }).first().click();
    } else {
      await page.getByRole("button", { name: /^nee$/i }).first().click();
    }

    await selects.nth(1).selectOption({ label: makelaar });

    await page.waitForTimeout(500);

    const inputsAfterMakelaar = page.locator("input:visible");

    if (String(makelaar).toLowerCase().includes("courtage")) {
      if (!makelaarscourtage) {
        return res.status(400).json({ error: "Makelaarscourtage ontbreekt" });
      }

      await inputsAfterMakelaar.nth(3).fill(String(makelaarscourtage));
    }

    if (String(makelaar).toLowerCase().includes("vaste")) {
      if (!makelaarskosten) {
        return res.status(400).json({ error: "Makelaarskosten ontbreekt" });
      }

      await inputsAfterMakelaar.nth(3).fill(String(makelaarskosten));
    }

    await selects.nth(3).selectOption({ label: String(jaar) });
    await selects.nth(4).selectOption({ label: overdrachtsbelasting });

    await page.getByRole("button", { name: /berekenen/i }).click();

    await page.waitForTimeout(3000);

    const resultText = await page.locator("body").innerText();

    res.json({
      success: true,
      resultaat: clean(resultText)
    });
  } catch (err) {
    try {
      const p = browser?.contexts()?.[0]?.pages()?.[0];
      if (p) {
        await p.screenshot({
          path: "error.png",
          fullPage: true
        });
      }
    } catch {}

    res.status(500).json({
      error: "Berekening mislukt",
      details: err.message,
      tip: "Bekijk error.png"
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API draait op poort ${PORT}`);
});