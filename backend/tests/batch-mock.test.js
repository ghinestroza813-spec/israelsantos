const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('mock-require');
const request = require('supertest');

test('Cadastro em lote exige autenticacao', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;

  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'fake-test-key';

    mock('@supabase/supabase-js', {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: null } })
        }
      })
    });

    delete require.cache[require.resolve('../src/server')];
    const app = require('../src/server');

    const response = await request(app)
      .post('/api/admin/products/2811de31-f8a0-4919-94c4-2efd67be69a1/variants/batch')
      .send({});

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required.');
  } finally {
    mock.stop('@supabase/supabase-js');
    delete require.cache[require.resolve('../src/server')];

    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;

    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});

test('Colaborador nao pode cadastrar variacoes em lote', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    secret: process.env.SUPABASE_SECRET_KEY,
    anon: process.env.SUPABASE_ANON_KEY
  };

  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'fake-service-key';
    process.env.SUPABASE_ANON_KEY = 'fake-anon-key';

    const fakeClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'test-user-123' } },
          error: null
        })
      },
      from: (table) => {
        assert.equal(table, 'admin_users');
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'test-user-123',
                  role: 'colaborador'
                },
                error: null
              })
            })
          })
        };
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

    assert.equal(response.status, 403);
    assert.equal(
      response.body.error,
      'Only the store owner can approve or publish products.'
    );
  } finally {
    mock.stop('@supabase/supabase-js');
    delete require.cache[require.resolve('../src/server')];

    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };

    restore('SUPABASE_URL', previous.url);
    restore('SUPABASE_SECRET_KEY', previous.secret);
    restore('SUPABASE_ANON_KEY', previous.anon);
  }
});

test('Cadastro em lote rejeita mais de 30 combinacoes', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    secret: process.env.SUPABASE_SECRET_KEY,
    anon: process.env.SUPABASE_ANON_KEY
  };

  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'fake-service-key';
    process.env.SUPABASE_ANON_KEY = 'fake-anon-key';

    mock('@supabase/supabase-js', {
      createClient: () => ({
        auth: {
          getUser: async () => ({
            data: { user: { id: 'test-owner-123' } },
            error: null
          })
        },
        from: (table) => {
          assert.equal(table, 'admin_users');
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { user_id: 'test-owner-123', role: 'admin' },
                  error: null
                })
              })
            })
          };
        }
      })
    });

    delete require.cache[require.resolve('../src/server')];
    const app = require('../src/server');

    const response = await request(app)
      .post('/api/admin/products/2811de31-f8a0-4919-94c4-2efd67be69a1/variants/batch')
      .set('Authorization', 'Bearer fake-test-token')
      .send({
        sku_prefix: 'TESTE',
        sizes: Array.from({ length: 6 }, (_, i) => `T${i + 1}`),
        colors: ['Preto', 'Branco', 'Azul', 'Verde', 'Vermelho', 'Cinza']
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'A batch may contain at most 30 combinations.');
  } finally {
    mock.stop('@supabase/supabase-js');
    delete require.cache[require.resolve('../src/server')];

    for (const [key, value] of [
      ['SUPABASE_URL', previous.url],
      ['SUPABASE_SECRET_KEY', previous.secret],
      ['SUPABASE_ANON_KEY', previous.anon]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


