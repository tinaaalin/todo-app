const input = document.querySelector(".composer__input");
const addButton = document.querySelector(".composer__add");
const list = document.querySelector(".todo-list");
const emptyState = document.querySelector(".list-panel__empty");

const todos = [];

function render() {
  list.innerHTML = "";

  todos.forEach((text, index) => {
    const item = document.createElement("li");
    item.className = "todo-item";

    const textEl = document.createElement("span");
    textEl.className = "todo-item__text";
    textEl.textContent = text;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "todo-item__delete";
    deleteButton.textContent = "删除";
    deleteButton.setAttribute("aria-label", `删除：${text}`);
    deleteButton.addEventListener("click", () => deleteTodo(index));

    item.appendChild(textEl);
    item.appendChild(deleteButton);
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

function deleteTodo(index) {
  todos.splice(index, 1);
  render();
}

addButton.addEventListener("click", addTodo);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTodo();
});

render();
