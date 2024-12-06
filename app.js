import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { availableParallelism } from "node:os";
import cluster from "node:cluster";
import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 8000 + i,
    });
  }
  setupPrimary();
} else {
  // open the database file
  const db = await open({
    filename: "chat.db",
    driver: sqlite3.Database,
  });

  // create our 'messages' table (you can ignore the 'client_offset' column for now)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
  );
`);
  // await db.run("DELETE FROM messages"); this to to reset the data in the database
  const app = express();

  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter(),
  });

  io.on("connection", async (socket) => {
    // console.log(`user is connected`);
    socket.on("chat message", async (msg, clientOffset, callback) => {
      let result;
      try {
        // store the message in the database
        result = await db.run(
          "INSERT INTO messages (content,client_offset) VALUES (?,?)",
          msg,
          clientOffset
        );
      } catch (e) {
        if (e.errno === 19) {
          callback();
        } else {
        }
        // TODO handle the failure
        return;
      }
      // include the offset with the message
      io.emit("chat message", msg, result.lastID);
      callback();
    });
    if (!socket.recovered) {
      // if the connection state recovery was not successful
      try {
        await db.each(
          "SELECT id, content FROM messages WHERE id > ?",
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit("chat message", row.content, row.id);
          }
        );
      } catch (e) {
        // something went wrong
      }
    }
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "index.html"));
  });

  const port = process.env.PORT;
  server.listen(port, () => {
    console.log(`the port is :${port}`);
  });
}
