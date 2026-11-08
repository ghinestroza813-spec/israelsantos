const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const request = require('supertest');

test('Retorna HTTP 409 quando o banco rejeita duplicidade', async () => {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY'
  ];

  const previous = Object.fromEntries(
    keys.map(key => [key, process.env[key]])
  );

  const productId = '2811de31-f8a0-4919-94c4-2efd67be69a1';
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

            insert: () => {
              insertCount++;

              return {
                select: async () => ({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint'
                  }
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
        sizes: ['M'],
        colors: ['Preto']
      });

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      'Duplicate SKU or size/color combination; no batch was created.'
    );
    assert.equal(insertCount, 1);
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
