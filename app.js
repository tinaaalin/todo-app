const input = document.querySelector(".composer__input");
const addButton = document.querySelector(".composer__add");
const list = document.querySelector(".todo-list");
const emptyState = document.querySelector(".list-panel__empty");

const todos = [];

function render() {
  list.innerHTML = "";

  todos.forEach((text) => {
    const item = document.createElement("li");
    item.className = "todo-item";

    const textEl = document.createElement("span");
    textEl.className = "todo-item__text";
    textEl.textContent = text;

    item.appendChild(textEl);
    list.appendChild(item);
  });

  emptyState.hidden = todos.length > 0;
}

function addTodo() {
  const text = input.value.trim();
  if (!text) return;

  todos.push(text);
  input.value = "";
  render();
}

addButton.addEventListener("click", addTodo);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTodo();
});

render();
