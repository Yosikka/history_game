const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const path = require("path");

app.use(express.static("public"));

// Балансы команд
let teams = {
    1: { name: "Политологи", balance: 1000 },
    2: { name: "Экономисты", balance: 1000 },
    3: { name: "Социологи", balance: 1000 },
    4: { name: "Культуристы", balance: 1000 },
    5: { name: "Дипломаты", balance: 1000 }
};

let currentTeam = 1;
let state = "waiting";
let questionIndex = 0;
let slotResult = null;
let currentBet = 0;
let chosen = new Set();
let question = null;

// Загружаем вопросы
const questions = fs.readdirSync("./questions").map(f =>
    JSON.parse(fs.readFileSync(path.join("./questions", f)))
);

function broadcast() {
    io.emit("state", {
        teams,
        currentTeam,
        state,
        slotResult,
        currentBet,
        question,
        questionIndex
    });
}

io.on("connection", socket => {
    // Инициализация состояния для нового игрока
    socket.emit("state", {
        teams,
        currentTeam,
        state: socket.teamId ? state : "teamSelect",
        slotResult,
        currentBet,
        question,
        questionIndex
    });

    // Игрок выбирает команду
    socket.on("teamSelect", team => {
        socket.teamId = team;
        chosen.add(team);
        socket.emit("hideTeamSelect");
    });

    // Ведущий начинает игру
    socket.on("startGame", () => {
        if (state === "waiting") {
            state = "bet";
            currentTeam = 1;
            questionIndex = 0;
            broadcast();
        }
    });

    // Ведущий сбрасывает игру
    socket.on("resetGame", () => {
        teams = {
            1: { name: "Политологи", balance: 1000 },
            2: { name: "Экономисты", balance: 1000 },
            3: { name: "Социологи", balance: 1000 },
            4: { name: "Культуристы", balance: 1000 },
            5: { name: "Дипломаты", balance: 1000 }
        };
        currentTeam = 1;
        state = "waiting";
        questionIndex = 0;
        currentBet = 0;
        slotResult = null;
        chosen.clear();
        question = null;
        broadcast();
    });

    // Игрок ставит
    socket.on("bet", amount => {
        if (socket.teamId !== currentTeam) return;
        amount = Number(amount);
        if (amount <= 0 || amount > teams[currentTeam].balance) return;

        currentBet = amount;
        teams[currentTeam].balance -= currentBet; // списываем ставку сразу

        // Генерируем слоты
        const fruits = ["fruit1.png", "fruit2.png", "fruit3.png"];
        const a = fruits[Math.floor(Math.random() * 3)];
        const b = fruits[Math.floor(Math.random() * 3)];
        const c = fruits[Math.floor(Math.random() * 3)];

        // Рассчитываем мультипликатор
        let multiplier = 1.5;
        if (a === b && b === c) multiplier = 5;
        else if (a === b || b === c || a === c) multiplier = 3;

        slotResult = { a, b, c, multiplier };
        state = "slots";
        broadcast();

        // Автоматический переход на showX и затем на вопрос
        setTimeout(() => {
            state = "showX";
            broadcast();

            setTimeout(() => {
                if (questionIndex < questions.length) {
                    question = questions[questionIndex++];
                    state = "question";
                    broadcast();
                } else {
                    state = "waiting"; // конец игры
                    broadcast();
                }
            }, 2000); // задержка перед показом вопроса
        }, 4500); // задержка после слотов
    });

    // Ведущий отвечает на вопрос
    socket.on("answer", correct => {
        if (slotResult && currentBet > 0 && correct) {
            teams[currentTeam].balance += Math.floor(currentBet * slotResult.multiplier);
        }
        currentBet = 0;
        slotResult = null;

        currentTeam++;
        if (currentTeam > 5) currentTeam = 1;

        state = "bet";
        broadcast();
    });
});

http.listen(3000, () => console.log("Исторический Додеп на 3000"));
