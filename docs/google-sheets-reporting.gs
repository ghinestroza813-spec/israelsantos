/**
 * Israel Santos Thaishop — Google Sheets reporting receiver
 *
 * Deploy as a Web App (execute as: Me; access: Anyone).
 * Configure Script Properties:
 *   CATALOG_REPORT_SECRET = same value as Render GOOGLE_SHEETS_WEBHOOK_SECRET
 *   REPORT_SPREADSHEET_ID = ID of the reporting spreadsheet
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('CATALOG_REPORT_SECRET');
  var spreadsheetId = props.getProperty('REPORT_SPREADSHEET_ID');
  if (!expected || !spreadsheetId) return json_({ ok: false, error: 'Reporting is not configured.' }, 503);

  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON.' }, 400);
  }
  if (!payload.secret || payload.secret !== expected) {
    return json_({ ok: false, error: 'Unauthorized.' }, 401);
  }
  if (!payload.product || !payload.action) {
    return json_({ ok: false, error: 'Missing product event.' }, 400);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName('Relatório de produtos') || ss.insertSheet('Relatório de produtos');
    var headers = [
      'Data do evento', 'Ação', 'ID Supabase', 'SKU', 'Nome', 'Slug',
      'Categoria', 'Marca', 'Preço', 'Estoque', 'Ativo na loja',
      'Aguardando revisão', 'URL da imagem', 'ID do responsável'
    ];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
    var p = payload.product;
    sheet.appendRow([
      new Date(),
      String(payload.action),
      String(p.id || ''),
      String(p.sku || ''),
      String(p.name || ''),
      String(p.slug || ''),
      String(p.category || ''),
      String(p.brand || ''),
      Number(p.price || 0),
      p.stock == null ? '' : Number(p.stock),
      p.is_active === true ? 'Sim' : 'Não',
      p.needs_review === true ? 'Sim' : 'Não',
      String(p.image_url || ''),
      String(p.created_by || p.reviewed_by || '')
    ]);
    return json_({ ok: true, recorded: true });
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
