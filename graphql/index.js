// require("dotenv").config();
// const { ApolloServer } = require("apollo-server");
// const mongoose = require("mongoose");
// const typeDefs = require("./schema.graphql");
// const resolvers = require("./resolvers");
// const createLoaders = require("./dataloader");
// const cache = require("./cache");

// // Load env
// const PORT = process.env.GRAPHQL_PORT || 4000;
// const MONGO_URI = process.env.MONGO_URI;

// // Boot function
// async function startGraphQL() {
//   try {
//     // MongoDB connection
//     await mongoose.connect(MONGO_URI, {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//     });
//     console.log("Mongo connected for GraphQL server");

//     // Redis cache
//     await cache.init(process.env.REDIS_URL);
//     console.log("Redis connected");

//     const server = new ApolloServer({
//       typeDefs,
//       resolvers,
//       context: () => {
//         return {
//           loaders: createLoaders(),
//           cache
//         };
//       },
//     });

//     const { url } = await server.listen(PORT);
//     console.log(`🚀 GraphQL server ready at ${url}`);

//   } catch (error) {
//     console.error("❌ GraphQL Server failed to start:", error);
//     process.exit(1);
//   }
// }

// startGraphQL();
