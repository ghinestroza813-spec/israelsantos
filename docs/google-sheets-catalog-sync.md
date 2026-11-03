# Google Sheets catalog intake and Drive image upload

This integration is staged on `feature/sheets-drive-image-upload`. It does not publish products and does not update existing products.

## Render environment

Already configured:
- `CATALOG_SYNC_SECRET`: same long random value used by Apps Script Script Properties.

Optional:
- `SUPABASE_STORAGE_BUCKET`: defaults to the existing public bucket `israel santos`. Set only if the actual bucket name differs.

## Google Apps Script properties

In Apps Script → Project Settings → Script properties:

- `API_BASE_URL` = `https://israelsantos.onrender.com`
- `CATALOG_SYNC_SECRET` = the same random secret configured in Render

## Product image input

In the Products sheet, column M accepts either:
- a Google Drive file ID (recommended), for a file shared with the Google account that owns the installable trigger; or
- an already-public HTTPS image URL.

Supported upload formats: JPEG, PNG, WebP, maximum 5 MB each. The Apps Script trigger reads the Drive file, posts its bytes to the protected Render endpoint, and the backend uploads it to the existing Supabase Storage bucket. The returned public URL is then attached to the pending product.

## Apps Script

Paste this into `Código.gs`, save, and run `installCatalogTrigger` once as the spreadsheet owner. Authorize the requested Google Sheets, Drive, and external-request permissions.

```javascript
function installCatalogTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "catalogOnEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("catalogOnEdit").forSpreadsheet(ss).onEdit().create();
}

function postCatalog_(path, payload, secret, baseUrl) {
  const response = UrlFetchApp.fetch(baseUrl + path, {
    method: "post",
    contentType: "application/json",
    headers: { "x-catalog-sync-secret": secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  let parsed = {};
  try { parsed = JSON.parse(body); } catch (_) {}
  if (status < 200 || status >= 300) {
    throw new Error("API rejected request (" + status + "): " + body.slice(0, 350));
  }
  return parsed;
}

function resolveProductImage_(input, secret, baseUrl) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;

  const file = DriveApp.getFileById(value);
  const mime = file.getMimeType();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    throw new Error("A imagem precisa ser JPEG, PNG ou WebP.");
  }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");
  const uploaded = postCatalog_("/api/integrations/sheets/images", {
    fileName: file.getName(),
    mimeType: mime,
    base64: Utilities.base64Encode(bytes)
  }, secret, baseUrl);
  return uploaded.image_url;
}

function catalogOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== "Produtos" || e.range.getRow() < 2) return;
  if (e.range.getColumn() !== 15 || String(e.value || "").trim().toLowerCase() !== "enviar") return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Outra sincronização está em andamento. Tente novamente.");
  try {
    const rowNumber = e.range.getRow();
    const row = sheet.getRange(rowNumber, 1, 1, 19).getValues()[0];
    const props = PropertiesService.getScriptProperties();
    const baseUrl = (props.getProperty("API_BASE_URL") || "").replace(/\/$/, "");
    const secret = props.getProperty("CATALOG_SYNC_SECRET");
    if (!baseUrl || !secret) throw new Error("Configure API_BASE_URL e CATALOG_SYNC_SECRET nas propriedades do script.");

    const price = Number(row[9]);
    const compareAt = row[10] === "" ? null : Number(row[10]);
    const stock = row[11] === "" ? null : Number(row[11]);
    const slug = String(row[3] || "").trim();
    const name = String(row[2] || "").trim();
    if (!slug || !name || !Number.isFinite(price)) throw new Error("Preencha Nome, Slug e Preço antes de enviar.");

    const imageUrl = resolveProductImage_(row[12], secret, baseUrl);
    const images = String(row[13] || "").split(/[\n,]/).map(s => s.trim()).filter(s => /^https:\/\//i.test(s));
    const payload = {
      slug, name,
      category: String(row[4] || "") || null,
      brand: String(row[5] || "") || null,
      description: String(row[6] || ""),
      price,
      compare_at_price: compareAt,
      sku: String(row[1] || "") || null,
      image_url: imageUrl,
      images,
      sizes: String(row[8] || "").split(",").map(s => s.trim()).filter(Boolean),
      stock
    };

    postCatalog_("/api/integrations/sheets/products", payload, secret, baseUrl);
    sheet.getRange(rowNumber, 15).setValue("Pendente");
    sheet.getRange(rowNumber, 16).setValue("Pendente");
    sheet.getRange(rowNumber, 19).setValue(new Date());
    if (imageUrl) sheet.getRange(rowNumber, 13).setNote("Imagem enviada ao Supabase Storage: " + imageUrl);
  } catch (error) {
    sheet.getRange(e.range.getRow(), 18).setValue("Falha no envio: " + String(error.message).slice(0, 400));
    throw error;
  } finally {
    lock.releaseLock();
  }
}
```

## Safety and limitations

- Product submissions are inserted only as `is_active=false` and `needs_review=true`.
- Existing products are never updated or deleted by this integration.
- Duplicate slug/SKU is rejected.
- Images are uploaded to Storage before product insertion. If product insertion fails, the uploaded image may remain as an unreferenced Storage object; remove it manually after review if needed.
- Approval/publication remains a manual action in the existing admin panel. The spreadsheet approval columns are tracking fields only.
- The installable trigger runs under the Google account that installed it. Drive images must be accessible to that account.
- Do not expose `CATALOG_SYNC_SECRET` in sheet cells or source code.
