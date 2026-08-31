'use strict';

// Ponto de entrada da funcao serverless da Vercel: reaproveita o app Express
// inteiro definido em server.js (rotas /api/*). Arquivos estaticos (public/)
// sao servidos direto pela Vercel, sem passar por aqui - ver vercel.json.
module.exports = require('../server.js');
