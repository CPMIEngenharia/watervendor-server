// gerador.js - Nosso programa para criar links de pagamento permanentes
// (Versão corrigida)

const axios = require('axios');

// --- DADOS DA NOSSA APLICAÇÃO (PRODUÇÃO) ---
const MP_ACCESS_TOKEN = 'APP_USR-2337638380276117-092714-fcb4c7f0435c786f6c58a959e3dac448-1036328569';

// #################################################################
// ESTA É A CORREÇÃO:
// Apontamos para o servidor CORRETO (sem o '-fabio')
// e para a rota CORRETA ('/notificacao-mp')
// #################################################################
const NOTIFICATION_URL = 'https://watervendor-server.onrender.com/notificacao-mp';

// --- DADOS DO PRODUTO QUE QUEREMOS CRIAR ---
// !! MODIFIQUE AQUI PARA CADA PRODUTO !!
const produto = {
  titulo: "Água Mineral 20 Litros",
  preco: 1.50,
  referencia_externa: "maquina01-20000" // Formato: maquinaID-volumeML
};
// Você pode alterar o produto acima para outros volumes, por exemplo:
// const produto = {
//   titulo: "Água Mineral 5 Litros",
//   preco: 1.00,
//   referencia_externa: "maquina01-5000" // Formato: maquinaID-volumeML
// };

// Função principal para criar a preferência de pagamento
async function criarPreferencia() {
  console.log(`Criando link para: ${produto.titulo}...`);

  const body = {
    items: [
      {
        title: produto.titulo,
        quantity: 1,
        unit_price: produto.preco,
        currency_id: "BRL"
      }
    ],
    external_reference: produto.referencia_externa,
    notification_url: NOTIFICATION_URL
  };

  try {
    const response = await axios.post('https://api.mercadopago.com/checkout/preferences', body, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("\n=======================================================");
    console.log("LINK DE PAGAMENTO CRIADO COM SUCESSO!");
    console.log(`Produto: ${produto.titulo}`);
    console.log(`Referência: ${produto.referencia_externa}`);
    console.log("\nCopie este link para gerar o seu QR Code fixo:");
    console.log(response.data.init_point); // Este é o link permanente!
    console.log("=======================================================\n");

  } catch (error) {
    console.error("!!! ERRO AO CRIAR PREFERÊNCIA !!!");
    console.error(error.response ? error.response.data : error.message);
  }
}

// Executa a função
criarPreferencia();