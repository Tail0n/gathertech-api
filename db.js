const { Pool } = require('pg');

// Configurações de acesso ao seu banco PostgreSQL
const pool = new Pool({
  user: 'postgres',        // Seu usuário do PostgreSQL
  host: '127.0.0.1',       // Endereço do servidor do banco
  database: 'GatherTech',  // Nome do banco criado no script DDL
  password: 'admin123',   // Substitua pela senha do seu PostgreSQL
  port: 5432,              // Porta padrão do PostgreSQL
});

// Teste de conexão inicial
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Erro ao conectar ao PostgreSQL:', err.stack);
  }
  console.log('Conexão com o banco de dados PostgreSQL estabelecida com sucesso!');
  release();
});

module.exports = pool;