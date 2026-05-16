const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

const URL = "https://www.hypotheker.nl/begrippenlijst/huis-kopen/kosten-koper/";

function parseEuro(text) {
  if (!text) return null;
  const match = text.match(/€\s?[\d.]+(?:,\d{2})?/);
  return match ? match[0].replace(/\s/g, "") : null;
}

async function clickRadioByQuestion(page, questionText, answerText) {
  const question = page.getByText(questionText, { exact: false });
  await question.waitFor({ timeout: 15000 });

  const container = question.locator("xpath=ancestor::*[self::div or self::fieldset][1]");
  const answer = container.getByText(answerText, { exact: false });

  await answer.click({ timeout: 10000 });
}

async function clickNext(page) {
  const buttons = page.locator("button, a");
  const count = await buttons.count();

  for (let i = count - 1; i >= 0; i--) {
    const btn = buttons.nth(i);
    const text = await btn.innerText().catch(() => "");
    if (
      text.toLowerCase().includes("ga verder") ||
      text.toLowerCase().includes("verder")
    ) {
      await btn.click();
      return;
    }
  }

  await page.locator("button").last().click();
}

app.post("/bereken", async (req, res) => {
  const {
    bedrag,
    nieuwbouw = "nee",
    samen = "alleen",
    jongerDan35 = "nee",
    startersvrijstellingGebruikt = "nee",
    zelfBewonen = "ja"
  } = req.body;

  if (!bedrag) {
    return res.status(400).json({
      error: "Geen bedrag meegegeven"
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 }
    });

    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Cookies accepteren indien zichtbaar
    try {
      await page.getByText(/alle cookies/i).click({ timeout: 5000 });
    } catch {}

    // Stap 1: bedrag invullen
    const bedragInput = page.locator("input").first();
    await bedragInput.fill(String(bedrag));

    // Nieuwbouw ja/nee
    await clickRadioByQuestion(
      page,
      "Is deze woning een nieuwbouwwoning",
      nieuwbouw.toLowerCase() === "ja" ? "Ja" : "Nee"
    );

    // Alleen/samen
    await clickRadioByQuestion(
      page,
      "Koop je de woning alleen of samen",
      samen.toLowerCase() === "samen" ? "Samen" : "Alleen"
    );

    await clickNext(page);

    // Stap 2
    await page.waitForTimeout(1000);

    await clickRadioByQuestion(
      page,
      "Ben je jonger dan 35 jaar",
      jongerDan35.toLowerCase() === "ja" ? "ja" : "nee"
    );

    await clickRadioByQuestion(
      page,
      "Heb je al eerder gebruik gemaakt",
      startersvrijstellingGebruikt.toLowerCase() === "ja" ? "ja" : "nee"
    );

    await clickRadioByQuestion(
      page,
      "Ga je zelf in de woning wonen",
      zelfBewonen.toLowerCase() === "ja" ? "ja" : "nee"
    );

    await clickNext(page);

    // Resultaat
    await page.waitForTimeout(2000);

    const totaalText = await page.locator("body").innerText();
    const totaalMatch = totaalText.match(/Kosten koper\s*€\s?[\d.]+/i);
    const totaal = totaalMatch ? parseEuro(totaalMatch[0]) : parseEuro(totaalText);

    // Klik "Toon berekening"
    try {
      await page.getByText("Toon berekening", { exact: false }).click({ timeout: 10000 });
      await page.waitForTimeout(1000);
    } catch {}

    const body = await page.locator("body").innerText();

    function getAmount(label) {
      const regex = new RegExp(label + "\\s+€\\s?[\\d.]+(?:,\\d{2})?", "i");
      const match = body.match(regex);
      return match ? parseEuro(match[0]) : null;
    }

    const resultaat = {
      totaalKostenKoper: totaal,
      overdrachtsbelasting: getAmount("Overdrachtsbelasting"),
      notariskosten: getAmount("Notariskosten"),
      aankoopmakelaarscourtage: getAmount("Evt\\. aankoopmakelaarscourtage"),
      taxatie: getAmount("Taxatie"),
      bouwkundigeKeuring: getAmount("Bouwkundige keuring"),
      nhg: getAmount("NHG"),
      adviesEnBemiddelingskosten: getAmount("Advies- & bemiddelingskosten"),
      input: {
        bedrag,
        nieuwbouw,
        samen,
        jongerDan35,
        startersvrijstellingGebruikt,
        zelfBewonen
      }
    };

    await browser.close();

    res.json(resultaat);
  } catch (error) {
    if (browser) await browser.close();

    res.status(500).json({
      error: "Berekening mislukt",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});