const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const request = require('supertest');

test('Cria 6 variacoes inativas com HTTP 201', async () => {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY'
  ];

  const previous = Object.fromEntries(
    keys.map(key => [key, process.env[key]])
  );

  const productId = '2811de31-f8a0-4919-94c4-2efd67be69a1';
  let insertedRows = null;
  let insertCount = 0;

  try {
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_SECRET_KEY = 'fake-service-key';
    process.env.SUPABASE_ANON_KEY = 'fake-anon-key';

    const fakeClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'test-owner-123' } },
          error: null
        })
      },

      from: (table) => {
        if (table === 'admin_users') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    user_id: 'test-owner-123',
                    role: 'admin'
                  },
                  error: null
                })
              })
            })
          };
        }

        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: productId },
                  error: null
                })
              })
            })
          };
        }

        if (table === 'product_variants') {
          return {
            select: () => ({
              eq: async () => ({
                data: [],
                error: null
              })
            }),

            insert: (rows) => {
              insertCount++;
              insertedRows = rows;

              return {
                select: async () => ({
                  data: rows.map((row, index) => ({
                    id: `fake-variant-${index + 1}`,
                    ...row
                  })),
                  error: null
                })
              };
            }
          };
        }

        throw new Error('Tabela inesperada: ' + table);
      }
    };

    mock('@supabase/supabase-js', {
      createClient: () => fakeClient
    });

    delete require.cache[require.resolve('../src/server')];
    const app = require('../src/server');

    const response = await request(app)
      .post(`/api/admin/products/${productId}/variants/batch`)
      .set('Authorization', 'Bearer fake-test-token')
      .send({
        sku_prefix: 'TESTE',
        sizes: ['P', 'M', 'G'],
        colors: ['Preto', 'Branco']
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.count, 6);
    assert.equal(response.body.variants.length, 6);

    assert.equal(insertCount, 1);
    assert.equal(insertedRows.length, 6);

    const expectedSkus = [
      'TESTE-P-PRETO',
      'TESTE-P-BRANCO',
      'TESTE-M-PRETO',
      'TESTE-M-BRANCO',
      'TESTE-G-PRETO',
      'TESTE-G-BRANCO'
    ];

    assert.deepEqual(
      insertedRows.map(row => row.sku),
      expectedSkus
    );

    for (const row of insertedRows) {
      assert.equal(row.product_id, productId);
      assert.equal(row.stock, 0);
      assert.equal(row.reserved_quantity, 0);
      assert.equal(row.is_active, false);
      assert.equal(row.price_override, null);
    }
  } finally {
    mock.stop('@supabase/supabase-js');
    delete require.cache[require.resolve('../src/server')];

    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});
