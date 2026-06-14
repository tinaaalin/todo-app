const input = document.querySelector(".composer__input");
const addButton = document.querySelector(".composer__add");
const list = document.querySelector(".todo-list");
const emptyState = document.querySelector(".list-panel__empty");
const versionEl = document.querySelector(".app__version");

// bump together with CACHE_VERSION in service-worker.js when releasing.
const APP_VERSION = "2026.06.14-1";
const STORAGE_KEY = "todos.v1";
const todos = loadTodos();

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — degrade silently.
  }
}

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
  saveTodos();
  render();
}

function deleteTodo(index) {
  todos.splice(index, 1);
  saveTodos();
  render();
}

addButton.addEventListener("click", addTodo);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTodo();
});

versionEl.textContent = `v${APP_VERSION}`;
render();
