const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const request = require('supertest');

test('Rejeita combinacao existente com HTTP 409', async () => {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY'
  ];

  const previous = Object.fromEntries(
    keys.map(key => [key, process.env[key]])
  );

  let insertCalled = false;

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
                  data: {
                    id: '2811de31-f8a0-4919-94c4-2efd67be69a1'
                  },
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
                data: [{ size: 'M', color: 'Preto' }],
                error: null
              })
            }),
            insert: () => {
              insertCalled = true;
              throw new Error('INSERT nao deveria acontecer');
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
      .post('/api/admin/products/2811de31-f8a0-4919-94c4-2efd67be69a1/variants/batch')
      .set('Authorization', 'Bearer fake-test-token')
      .send({
        sku_prefix: 'TESTE',
        sizes: ['M'],
        colors: ['Preto']
      });

    assert.equal(response.status, 409);
    assert.equal(
      response.body.error,
      'At least one size/color combination already exists for this product.'
    );
    assert.equal(insertCalled, false);
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
