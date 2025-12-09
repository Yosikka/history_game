const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const path = require("path");

app.use(express.static("public"));

// Балансы + карты
let teams = {
    1: { name: "Политологи", balance: 1000, cards: [] },
    2: { name: "Экономисты", balance: 1000, cards: [] },
    3: { name: "Социологи", balance: 1000, cards: [] },
    4: { name: "Культурологи", balance: 1000, cards: [] },
    5: { name: "Дипломаты", balance: 1000, cards: [] }
};

let currentTeam = 1;
let state = "waiting";
let questionIndex = 0;
let slotResult = null;
let currentBet = 0;
let chosen = new Set();
let question = null;

let betModifiers = {shield: false, reverse: false };

let currentMultiplier = 1;

const cardTypes = ["x2", "x0.5", "shield", "reverse", "kub"];

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

function giveRandomCard(team) {
    const card = cardTypes[Math.floor(Math.random() * cardTypes.length)];
    teams[team].cards.push(card);

    // уведомление ТОЛЬКО команде, которая получила карту
    for (let socketId in io.sockets.sockets) {
        const player = io.sockets.sockets[socketId];
        if (player.teamId === team) {
            player.emit("cardGivenYou", { card });
        }
    }
}


function removeCard(team, card) {
    const index = teams[team].cards.indexOf(card);
    if (index !== -1) teams[team].cards.splice(index, 1);
}

io.on("connection", socket => {
    socket.emit("state", {
        teams,
        currentTeam,
        state: socket.teamId ? state : "teamSelect",
        slotResult,
        currentBet,
        question,
        questionIndex
    });

    socket.on("teamSelect", team => {
        socket.teamId = team;
        chosen.add(team);
        socket.emit("hideTeamSelect");
    });

    socket.on("startGame", () => {
        if (state === "waiting") {
            state = "bet";
            currentTeam = 1;
            questionIndex = 0;
            broadcast();
        }
    });

    socket.on("resetGame", () => {
        teams = {
            1: { name: "Политологи", balance: 1000, cards: [] },
            2: { name: "Экономисты", balance: 1000, cards: [] },
            3: { name: "Социологи", balance: 1000, cards: [] },
            4: { name: "Культурологи", balance: 1000, cards: [] },
            5: { name: "Дипломаты", balance: 1000, cards: [] }
        };
        currentTeam = 1;
        state = "waiting";
        questionIndex = 0;
        currentBet = 0;
        slotResult = null;
        chosen.clear();
        question = null;
        betModifiers = { x2: false, x05: 0, shield: false, reverse: false };
        broadcast();
    });

    socket.on("bet", amount => {
        if (socket.teamId !== currentTeam) return;
        amount = Number(amount);
        if (amount <= 0 || amount > teams[currentTeam].balance) return;

        currentBet = amount;
        teams[currentTeam].balance -= currentBet;

        const fruits = ["fruit1.png", "fruit2.png", "fruit3.png"];
        const a = fruits[Math.floor(Math.random() * 3)];
        const b = fruits[Math.floor(Math.random() * 3)];
        const c = fruits[Math.floor(Math.random() * 3)];

        let multiplier = 1.5;
        if (a === b && b === c) multiplier = 5;
        else if (a === b || b === c || a === c) multiplier = 3;

        slotResult = { a, b, c, multiplier };
        state = "slots";
        broadcast();

        setTimeout(() => {
            state = "showX";
            broadcast();

            setTimeout(() => {
                if (questionIndex < questions.length) {
                    question = questions[questionIndex++];
                    state = "question";
                    broadcast();
                } else {
                    state = "waiting";
                    broadcast();
                }
            }, 2000);
        }, 5500);
    });

    socket.on("useCard", card => {
        if (!teams[socket.teamId].cards.includes(card)) return;

        removeCard(socket.teamId, card);

        switch (card) {
            case "x2":
                if (socket.teamId === currentTeam && state === "bet") {
                    currentMultiplier *= 2;
                }
                break;
            case "x0.5":
                if (socket.teamId !== currentTeam && state === "bet") {
                    currentMultiplier /= 2;
                }
                break;
            case "shield":
                if (socket.teamId === currentTeam && state === "bet") {
                    betModifiers.shield = true;
                }
                break;
            case "reverse":
                betModifiers.reverse = true;
                break;
            case "kub":
                if (state === "bet") {
                    let kubEffect = Math.random() < 0.5 ? 2 : 0.5; // сохраняем результат
                    currentMultiplier *= kubEffect;

                    // отправляем уведомление, что куб сработал
                    io.to(socket.id).emit("cardUsedYou", { card, result: kubEffect });
                    socket.broadcast.emit("cardUsedOther", { team: socket.teamId, card, result: kubEffect });
                    broadcast();
                    return; // выходим, чтобы не дублировать отправку уведомлений
                }
                break;
        }

        // лично использовавшему — отдельное уведомление
        io.to(socket.id).emit("cardUsedYou", { card });

        // другим — только информация
        socket.broadcast.emit("cardUsedOther", {
            team: socket.teamId,
            card
        });

        broadcast();
    });

    socket.on("answer", correct => {
        // вычисляем выигрыш и баланс
        if (slotResult && currentBet > 0 && correct) {
            let win = currentBet * slotResult.multiplier * currentMultiplier;
            if (betModifiers.x2) win *= 2;
            if (betModifiers.x05 > 0) win /= Math.pow(2, betModifiers.x05);
            teams[currentTeam].balance += Math.floor(win);
        } else if (!correct && betModifiers.shield) {
            teams[currentTeam].balance += Math.floor(currentBet / 2);
        }
        if (teams[currentTeam].balance == 0) {
            teams[currentTeam].balance = 100;
        }
        // сообщаем клиентам показать ответ
        io.emit("state", {
            teams,
            currentTeam,
            state: "question",
            question,
            showAnswer: true,
            questionIndex
        });

        // пауза 3 секунды перед следующим ходом
        setTimeout(() => {

            if (questionIndex % 3 === 0) {
                for (let t = 1; t <= 5; t++) {
                    giveRandomCard(t);
                }
            }
            if (betModifiers.reverse) {
                currentTeam--;
                if (currentTeam < 1) currentTeam = 5;
            } else {
                currentTeam++;
                if (currentTeam > 5) currentTeam = 1;
            }

            // увеличиваем индекс вопроса
            if (questionIndex < questions.length) {
                question = questions[questionIndex]; // следующий вопрос
                state = "bet";
            } else {
                state = "waiting";
            }

            // сброс ставок и модификаторов
            currentBet = 0;
            slotResult = null;
            betModifiers = {shield: false};
            currentMultiplier = 1;
            if (questionIndex == 30) {
                state = "end";
                broadcast();
                return;
            }
            broadcast();
        }, 3000);
    });


});

http.listen(3000, () => console.log("Историческая игра на 3000"));
