import json
import os
import shutil
import re
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk
from copy import deepcopy

# =====================
# CONFIG
# =====================
PROJECTS_JSON = "data/projects.json"
IMAGES_DIR = "images"
THUMBNAILS_DIR = os.path.join(IMAGES_DIR, "thumbnails")
GALLERY_DIR = os.path.join(IMAGES_DIR, "gallery")

THUMBNAIL_SIZE = (220, 220)
GALLERY_SIZE = (120, 120)

FIELD_MAP = {
    "title": "Title",
    "client": "Client",
    "role": "Role",
    "year": "Year",
    "vimeoId": "Vimeo ID",
    "youtubeId": "Youtube ID",
    "description": "Description",
    "production": "Production",
}

# =====================
# HELPERS
# =====================
def load_data():
    with open(PROJECTS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    with open(PROJECTS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# =====================
# SCROLLABLE FRAME
# =====================
class ScrollableFrame(ttk.Frame):
    def __init__(self, container, *args, **kwargs):
        super().__init__(container, *args, **kwargs)
        self.canvas = tk.Canvas(self)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = ttk.Frame(self.canvas)

        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )

        self.scrollable_frame_id = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Make the inner frame match the canvas width
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        # --- MOUSE WHEEL SCROLL ---
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)      # Windows/macOS
        self.canvas.bind_all("<Button-4>", self._on_mousewheel_linux)  # Linux scroll up
        self.canvas.bind_all("<Button-5>", self._on_mousewheel_linux)  # Linux scroll down

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self.scrollable_frame_id, width=event.width)

    def _on_mousewheel(self, event):
        # Windows: event.delta is multiples of 120
        self.canvas.yview_scroll(int(-1*(event.delta/120)), "units")

    def _on_mousewheel_linux(self, event):
        if event.num == 4:
            self.canvas.yview_scroll(-1, "units")
        elif event.num == 5:
            self.canvas.yview_scroll(1, "units")


# =====================
# APP
# =====================
class PortfolioApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio CMS")
        self.geometry("1400x800")

        self.data = load_data()
        self.projects = self.data["projects"]
        self.categories = [c["id"] for c in self.data["categories"]]

        self.selected_index = None
        self.drag_index = None

        self.thumbnail_image = None
        self.gallery_images = []

        self.new_thumbnail = None
        self.new_gallery = None

        self.build_ui()
        self.populate_tree()

        if self.projects:
            self.selected_index = 0
            first_cat = self.tree.get_children()[0]
            first_proj = self.tree.get_children(first_cat)[0]
            self.tree.selection_set(first_proj)
            self.load_project_into_fields()

    # ---------- UI ----------
    def build_ui(self):
        container = tk.Frame(self)
        container.pack(fill="both", expand=True)

        # LEFT
        left = tk.Frame(container, width=320)
        left.pack(side="left", fill="y")
        left.pack_propagate(False)

        self.tree = ttk.Treeview(left, show="tree")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)
        self.tree.focus_set()

        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        self.tree.bind("<ButtonPress-1>", self.start_drag)
        self.tree.bind("<ButtonRelease-1>", self.end_drag)

        # Navigation
        self.tree.bind("<Up>", self.on_key_up)
        self.tree.bind("<Down>", self.on_key_down)

        # Reorder (Cmd)
        self.tree.bind("<Command-Up>", lambda e: self.reorder_project(-1))
        self.tree.bind("<Command-Down>", lambda e: self.reorder_project(1))
        self.bind("<Command-n>", lambda e: self.create_new_project())

        # Focus shortcuts
        self.bind("<Return>", self.focus_title)
        self.bind("<Escape>", self.focus_tree)

        btn_frame = tk.Frame(left)
        btn_frame.pack(fill="x", pady=10)
        tk.Button(btn_frame, text="➕ New Project", command=self.create_new_project).pack(fill="x", pady=2)
        tk.Button(btn_frame, text="🗑 Delete Project", command=self.delete_project).pack(fill="x", pady=2)
        tk.Button(btn_frame, text="💾 Save All Changes", command=self.save_all_changes).pack(fill="x", pady=2)

        # RIGHT
        right_outer = tk.Frame(container)
        right_outer.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        self.right_scroll = ScrollableFrame(right_outer)
        self.right_scroll.pack(fill="both", expand=True)
        right = self.right_scroll.scrollable_frame

        self.fields = {}
        for key, label in FIELD_MAP.items():
            tk.Label(right, text=label).pack(anchor="w")
            entry = tk.Entry(right)
            entry.pack(fill="x", pady=2)
            self.fields[key] = entry

        tk.Label(right, text="Category").pack(anchor="w")
        self.category_var = tk.StringVar()
        ttk.Combobox(
            right, values=self.categories, textvariable=self.category_var, state="readonly"
        ).pack(fill="x")

        tk.Label(right, text="Thumbnail").pack(anchor="w", pady=(10, 0))
        self.thumbnail_label = tk.Label(right)
        self.thumbnail_label.pack(fill="x")
        tk.Button(right, text="Change Thumbnail", command=self.pick_thumbnail).pack(fill="x", pady=5)

        tk.Label(right, text="Gallery").pack(anchor="w", pady=(10, 0))
        self.gallery_canvas = tk.Canvas(right, height=150)
        self.gallery_scroll = ttk.Scrollbar(right, orient="horizontal", command=self.gallery_canvas.xview)
        self.gallery_frame = tk.Frame(self.gallery_canvas)

        self.gallery_canvas.create_window((0, 0), window=self.gallery_frame, anchor="nw")
        self.gallery_canvas.configure(xscrollcommand=self.gallery_scroll.set)
        self.gallery_canvas.pack(fill="x", expand=True)
        self.gallery_scroll.pack(fill="x")

        self.gallery_frame.bind(
            "<Configure>",
            lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all"))
        )

        tk.Button(right, text="Replace Gallery Images", command=self.pick_gallery).pack(fill="x", pady=5)

        tk.Button(
            right_outer, text="💾 Save Project Changes", command=self.save_changes
        ).pack(fill="x", pady=10)

    # ---------- Focus helpers ----------
    def focus_title(self, event=None):
        self.fields["title"].focus_set()
        self.fields["title"].select_range(0, tk.END)
        return "break"

    def focus_tree(self, event=None):
        self.tree.focus_set()
        return "break"

    # ---------- Tree ----------
    def populate_tree(self, selected_index=None):
        current = selected_index if selected_index is not None else self.selected_index
        self.tree.delete(*self.tree.get_children())

        self.category_nodes = {}
        for cat in self.categories:
            self.category_nodes[cat] = self.tree.insert("", "end", text=cat, open=True)

        for i, project in enumerate(self.projects):
            item = self.tree.insert(
                self.category_nodes[project["category"]],
                "end",
                text=project["title"],
                values=(i,),
            )
            if current is not None and i == current:
                self.tree.selection_set(item)
                self.tree.see(item)

    def on_select(self, _):
        sel = self.tree.selection()
        if not sel:
            return
        item = sel[0]
        if not self.tree.parent(item):
            return
        self.selected_index = int(self.tree.item(item, "values")[0])
        self.load_project_into_fields()

    # ---------- Keyboard navigation ----------
    def get_all_project_items(self):
        items = []
        for cat in self.tree.get_children():
            items.extend(self.tree.get_children(cat))
        return items

    def move_selection(self, direction):
        items = self.get_all_project_items()
        if not items:
            return

        sel = self.tree.selection()
        if not sel:
            self.tree.selection_set(items[0])
            return

        index = items.index(sel[0])
        new_index = index + direction

        if 0 <= new_index < len(items):
            self.tree.selection_set(items[new_index])
            self.tree.see(items[new_index])

    def on_key_up(self, event):
        self.move_selection(-1)
        return "break"

    def on_key_down(self, event):
        self.move_selection(1)
        return "break"

    # ---------- Cmd reorder ----------
    def reorder_project(self, direction):
        if self.selected_index is None:
            return "break"

        new_index = self.selected_index + direction
        if not (0 <= new_index < len(self.projects)):
            return "break"

        a = self.projects[self.selected_index]
        b = self.projects[new_index]

        if a["category"] != b["category"]:
            return "break"

        self.projects[self.selected_index], self.projects[new_index] = (
            self.projects[new_index],
            self.projects[self.selected_index],
        )

        self.selected_index = new_index
        self.populate_tree(self.selected_index)
        return "break"

    # ---------- Drag reorder ----------
    def start_drag(self, event):
        self.drag_index = self.tree.identify_row(event.y)

    def end_drag(self, event):
        target = self.tree.identify_row(event.y)
        if not target or not self.drag_index:
            return

        if self.tree.parent(target) != self.tree.parent(self.drag_index):
            self.drag_index = None
            return

        src = int(self.tree.item(self.drag_index, "values")[0])
        dst = int(self.tree.item(target, "values")[0])

        project = self.projects.pop(src)
        self.projects.insert(dst, project)

        self.selected_index = dst
        self.populate_tree(self.selected_index)
        self.drag_index = None

    # ---------- Duplicate ----------
    def duplicate_project(self):
        if self.selected_index is None:
            return

        original = self.projects[self.selected_index]
        copy_proj = deepcopy(original)

        base = f'{original["id"]}-copy'
        ids = {p["id"] for p in self.projects}
        new_id = base
        i = 1
        while new_id in ids:
            new_id = f"{base}-{i}"
            i += 1

        copy_proj["id"] = new_id
        copy_proj["title"] = f'{original.get("title", "")} (Copy)'

        self.projects.insert(self.selected_index + 1, copy_proj)
        self.selected_index += 1
        self.populate_tree(self.selected_index)

    # ---------- Load project ----------
    def load_project_into_fields(self):
        if self.selected_index is None:
            return
        project = self.projects[self.selected_index]

        for key, entry in self.fields.items():
            entry.delete(0, tk.END)
            entry.insert(0, project.get(key, ""))

        self.category_var.set(project.get("category", ""))
        self.load_thumbnail(project)
        self.load_gallery(project)

    # ---------- Images ----------
    def load_thumbnail(self, project):
        try:
            img = Image.open(os.path.join(THUMBNAILS_DIR, project["thumbnail"]))
            img.thumbnail(THUMBNAIL_SIZE)
            self.thumbnail_image = ImageTk.PhotoImage(img)
            self.thumbnail_label.config(image=self.thumbnail_image)
        except Exception:
            self.thumbnail_label.config(image="")

    def load_gallery(self, project):
        for w in self.gallery_frame.winfo_children():
            w.destroy()
        self.gallery_images.clear()

        if project.get("category") != "colour-grading":
            return

        for idx, rel in enumerate(project.get("gallery", [])):
            try:
                img = Image.open(os.path.join(GALLERY_DIR, rel))
                img.thumbnail(GALLERY_SIZE)
                tk_img = ImageTk.PhotoImage(img)
                self.gallery_images.append(tk_img)
                lbl = tk.Label(self.gallery_frame, image=tk_img)
                lbl.pack(side="left", padx=4)
                lbl.bind("<Button-1>", lambda e, i=idx: self.remove_gallery_image(i))
            except Exception:
                pass

    def remove_gallery_image(self, index):
        self.projects[self.selected_index]["gallery"].pop(index)
        self.load_gallery(self.projects[self.selected_index])

    # ---------- Pickers ----------
    def pick_thumbnail(self):
        self.new_thumbnail = filedialog.askopenfilename(
            filetypes=[("Images", "*.png *.jpg *.jpeg")]
        )

    def pick_gallery(self):
        self.new_gallery = filedialog.askopenfilenames(
            filetypes=[("Images", "*.png *.jpg *.jpeg")]
        )

    # ---------- Save ----------
    def save_changes(self):
        if self.selected_index is None:
            return

        project = self.projects[self.selected_index]

        for key, entry in self.fields.items():
            val = entry.get().strip()
            if val:
                project[key] = val
            else:
                project.pop(key, None)

        project["category"] = self.category_var.get()

        self.populate_tree(self.selected_index)
        self.load_project_into_fields()

    # ---------- Create / Delete ----------
    def create_new_project(self):
        title = simpledialog.askstring("New Project", "Enter new project title:")
        if not title:
            return

        base = re.sub(r'[^a-z0-9\-]', '', title.lower().replace(' ', '-'))
        ids = {p["id"] for p in self.projects}
        new_id = base
        i = 1
        while new_id in ids:
            new_id = f"{base}-{i}"
            i += 1

        project = {
            "id": new_id,
            "title": title,
            "category": self.categories[0] if self.categories else "",
        }

        self.projects.append(project)
        self.selected_index = len(self.projects) - 1
        self.populate_tree(self.selected_index)
        self.load_project_into_fields()

    def delete_project(self):
        if self.selected_index is None:
            return
        self.projects.pop(self.selected_index)
        self.selected_index = max(0, self.selected_index - 1) if self.projects else None
        self.populate_tree(self.selected_index)
        self.load_project_into_fields()

    # ---------- Save all ----------
    def save_all_changes(self):
        save_data(self.data)
        messagebox.showinfo("Saved", "All changes saved.")


# =====================
# RUN
# =====================
if __name__ == "__main__":
    PortfolioApp().mainloop()