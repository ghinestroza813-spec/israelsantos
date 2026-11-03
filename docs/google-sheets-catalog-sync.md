# Google Sheets catalog intake

This integration is intentionally staged on a feature branch. It does not publish products and does not update existing products.

## Render environment variable

Add `CATALOG_SYNC_SECRET` in the Render service Environment. Generate a long random secret (at least 32 characters) and keep it private. Never put the Supabase secret in Google Sheets or Apps Script.

## Google Apps Script

Open the spreadsheet, choose Extensions → Apps Script, paste the code below, then save. In Apps Script → Project Settings → Script properties, add:

- `API_BASE_URL` = `https://israelsantos.onrender.com`
- `CATALOG_SYNC_SECRET` = the same random secret configured in Render

Run `installCatalogTrigger` once and authorize it. The collaborator should set column O (Status do cadastro) to `Enviar` only after completing the row.

```javascript
function installCatalogTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "catalogOnEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("catalogOnEdit").forSpreadsheet(ss).onEdit().create();
}

function catalogOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== "Produtos" || e.range.getRow() < 2) return;
  if (e.range.getColumn() !== 15 || String(e.value || "").trim().toLowerCase() !== "enviar") return;

  const row = sheet.getRange(e.range.getRow(), 1, 1, 19).getValues()[0];
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty("API_BASE_URL") || "").replace(/\/$/, "");
  const secret = props.getProperty("CATALOG_SYNC_SECRET");
  if (!baseUrl || !secret) throw new Error("Configure API_BASE_URL and CATALOG_SYNC_SECRET in Script Properties.");

  const price = Number(row[9]);
  const compareAt = row[10] === "" ? null : Number(row[10]);
  const stock = row[11] === "" ? null : Number(row[11]);
  const slug = String(row[3] || "").trim();
  const name = String(row[2] || "").trim();
  if (!slug || !name || !Number.isFinite(price)) throw new Error("Preencha Nome, Slug e Preço antes de enviar.");

  const images = String(row[13] || "").split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  const payload = {
    slug, name,
    category: String(row[4] || ""),
    brand: String(row[5] || ""),
    description: String(row[6] || ""),
    price,
    compare_at_price: compareAt,
    sku: String(row[1] || "") || null,
    image_url: String(row[12] || "") || null,
    images,
    sizes: String(row[8] || "").split(",").map(s => s.trim()).filter(Boolean),
    stock
  };

  const response = UrlFetchApp.fetch(baseUrl + "/api/integrations/sheets/products", {
    method: "post",
    contentType: "application/json",
    headers: { "x-catalog-sync-secret": secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const result = response.getContentText();
  if (status === 201) {
    sheet.getRange(e.range.getRow(), 15).setValue("Pendente");
    sheet.getRange(e.range.getRow(), 16).setValue("Pendente");
    sheet.getRange(e.range.getRow(), 19).setValue(new Date());
  } else {
    sheet.getRange(e.range.getRow(), 18).setValue("Falha no envio (" + status + "): " + result.slice(0, 400));
    throw new Error("Catalog API rejected the row (" + status + "): " + result);
  }
}
```

## Current behavior and limitations

- New rows are inserted into `public.products` with `is_active=false` and `needs_review=true`.
- Duplicate slug/SKU is rejected; existing rows are never updated by this intake endpoint.
- Existing products are not modified or deleted.
- The current intake expects public HTTPS image URLs. Drive-file upload to Supabase Storage is a separate next step; do not paste private Drive URLs and assume the storefront can display them.
- Approval/publication remains a manual admin action in the existing admin panel. The spreadsheet's approval columns are tracking fields only at this stage.
- Deploy this branch only after review and a test using a new, clearly marked test product.
