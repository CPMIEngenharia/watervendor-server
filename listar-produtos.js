const axios = require('axios');

// ==================================================================
// CONFIGURAÇÃO DO CLIENTE ATUAL
// ==================================================================
// Coloque aqui o Access Token de Produção do SEU CLIENTE.
// Para testar agora, use o seu próprio token (o mesmo que está no Render).
const MP_ACCESS_TOKEN = 'APP_USR-SEU-TOKEN-AQUI';

async function listarProdutos() {
  console.log("\n🕵️  A iniciar a pesquisa de produtos no Mercado Pago...");
  console.log("🔑 A usar o token que começa por: " + MP_ACCESS_TOKEN.substring(0, 15) + "...");

  try {
    // 1. Pesquisar todos os itens do vendedor
    const searchResponse = await axios.get('https://api.mercadolibre.com/users/me/items/search', {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });

    const itemsIds = searchResponse.data.results;

    if (!itemsIds || itemsIds.length === 0) {
        console.log("\n❌ NENHUM PRODUTO ENCONTRADO NESTA CONTA.");
        console.log("👉 Certifique-se de que criou os produtos no painel do Mercado Pago (Secção 'Seu Negócio' -> 'Produtos').");
        return;
    }

    console.log(`\n✅ Encontrados ${itemsIds.length} produtos. A obter detalhes...\n`);

    // 2. Obter os detalhes de cada item (Título, Preço, ID)
    // A API permite consultar vários IDs de uma vez separando por vírgula
    const detailsResponse = await axios.get(`https://api.mercadolibre.com/items?ids=${itemsIds.join(',')}`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });

    console.log("==========================================");
    console.log("   LISTA DE PRODUTOS DO CLIENTE");
    console.log("==========================================\n");

    detailsResponse.data.forEach(itemWrapper => {
        if (itemWrapper.code === 200) {
            const prod = itemWrapper.body;
            console.log(`📦 NOME:  ${prod.title}`);
            console.log(`💲 PREÇO: R$ ${prod.price}`);
            console.log(`🔑 ID:    ${prod.id}`);
            console.log(`🏷️ SKU:   ${prod.seller_custom_field || '(Vazio)'}`);
            console.log("------------------------------------------");
        }
    });

    console.log("\n👉 Use o 'ID' acima para criar os links fixos da máquina.");
    console.log("Exemplo: https://watervendor-server.onrender.com/comprar/maquina01/MLB123456789");

  } catch (error) {
    console.error("\n💥 ERRO AO LISTAR PRODUTOS:");
    if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error("Erro MP:", JSON.stringify(error.response.data, null, 2));
    } else {
        console.error(error.message);
    }
  }
}

listarProdutos();