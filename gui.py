import json
import os
import shutil
import re
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk

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

        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scrollbar.set)

        self.canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

# =====================
# APP
# =====================
class PortfolioApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Portfolio CMS")
        self.geometry("1700x800")  # starting size

        self.data = load_data()
        self.projects = self.data["projects"]
        self.categories = [c["id"] for c in self.data["categories"]]

        self.selected_index = None
        self.drag_index = None

        self.thumbnail_image = None
        self.gallery_images = []

        # Temp variables for edits
        self.new_thumbnail = None
        self.new_gallery = None

        self.build_ui()
        self.populate_tree()

        # Auto-select first project
        if self.projects:
            self.selected_index = 0
            first_category_id = self.tree.get_children()[0]
            first_project_id = self.tree.get_children(first_category_id)[0]
            self.tree.selection_set(first_project_id)
            self.load_project_into_fields()

    # ---------- UI ----------
    def build_ui(self):
        container = tk.Frame(self)
        container.pack(fill="both", expand=True)

        # LEFT panel (project list)
        left = tk.Frame(container, width=500)
        left.pack(side="left", fill="y")
        left.pack_propagate(False)

        self.tree = ttk.Treeview(left, show="tree")
        self.tree.pack(fill="both", expand=True, padx=10, pady=10)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        self.tree.bind("<ButtonPress-1>", self.start_drag)
        self.tree.bind("<ButtonRelease-1>", self.end_drag)

        # Buttons at bottom of LEFT panel
        btn_frame = tk.Frame(left)
        btn_frame.pack(fill="x", pady=10)
        tk.Button(btn_frame, text="➕ New Project", command=self.create_new_project).pack(fill="x", pady=2)
        tk.Button(btn_frame, text="🗑 Delete Project", command=self.delete_project).pack(fill="x", pady=2)
        tk.Button(btn_frame, text="💾 Save All Changes", command=self.save_all_changes).pack(fill="x", pady=2)

        # RIGHT panel container
        right_outer = tk.Frame(container)
        right_outer.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        # Scrollable part
        self.right_scroll = ScrollableFrame(right_outer)
        self.right_scroll.pack(fill="both", expand=True)
        right = self.right_scroll.scrollable_frame

        # Fields
        self.fields = {}
        for key, label in FIELD_MAP.items():
            tk.Label(right, text=label).pack(anchor="w")
            entry = tk.Entry(right)
            entry.pack(fill="x", pady=2, expand=True)
            self.fields[key] = entry

        # Category
        tk.Label(right, text="Category").pack(anchor="w")
        self.category_var = tk.StringVar()
        ttk.Combobox(
            right, values=self.categories, textvariable=self.category_var, state="readonly"
        ).pack(fill="x", expand=True)

        # Thumbnail
        tk.Label(right, text="Thumbnail").pack(anchor="w", pady=(10, 0))
        self.thumbnail_label = tk.Label(right)
        self.thumbnail_label.pack()
        tk.Button(right, text="Change Thumbnail", command=self.pick_thumbnail).pack(pady=5, fill="x")

        # Gallery
        tk.Label(right, text="Gallery").pack(anchor="w", pady=(10, 0))
        self.gallery_canvas = tk.Canvas(right, height=150)
        self.gallery_scroll = ttk.Scrollbar(
            right, orient="horizontal", command=self.gallery_canvas.xview
        )
        self.gallery_frame = tk.Frame(self.gallery_canvas)
        self.gallery_canvas.create_window((0, 0), window=self.gallery_frame, anchor="nw")
        self.gallery_canvas.configure(xscrollcommand=self.gallery_scroll.set)
        self.gallery_canvas.pack(fill="x", expand=True)
        self.gallery_scroll.pack(fill="x")
        self.gallery_frame.bind(
            "<Configure>",
            lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all")),
        )
        tk.Button(right, text="Replace Gallery Images", command=self.pick_gallery).pack(pady=5, fill="x")

        # Save Project button OUTSIDE scroll, always visible
        self.save_project_btn = tk.Button(right_outer, text="💾 Save Project Changes", command=self.save_changes)
        self.save_project_btn.pack(fill="x", pady=10)

    # ---------- Tree ----------
    def populate_tree(self, selected_index=None):
        current_selection = selected_index if selected_index is not None else self.selected_index
        self.tree.delete(*self.tree.get_children())

        self.category_nodes = {}
        for cat in self.categories:
            self.category_nodes[cat] = self.tree.insert("", "end", text=cat, open=True)

        for i, project in enumerate(self.projects):
            item_id = self.tree.insert(
                self.category_nodes[project["category"]],
                "end",
                text=project["title"],
                values=(i,),
            )
            if current_selection is not None and i == current_selection:
                self.tree.selection_set(item_id)
                self.tree.see(item_id)

    def on_select(self, event):
        item = self.tree.selection()
        if not item:
            return
        item = item[0]
        parent = self.tree.parent(item)
        if parent == "":
            return
        self.selected_index = int(self.tree.item(item, "values")[0])
        self.load_project_into_fields()

    # ---------- Load project into UI ----------
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

    # ---------- Drag reorder ----------
    def start_drag(self, event):
        item = self.tree.identify_row(event.y)
        if item:
            self.drag_index = item

    def end_drag(self, event):
        target = self.tree.identify_row(event.y)
        if not target or not self.drag_index:
            return

        src_item = self.drag_index
        dst_item = target

        src_parent = self.tree.parent(src_item)
        dst_parent = self.tree.parent(dst_item)

        if src_parent != dst_parent or src_parent == "":
            self.drag_index = None
            return

        src_idx = int(self.tree.item(src_item, "values")[0])
        dst_idx = int(self.tree.item(dst_item, "values")[0])

        project = self.projects.pop(src_idx)
        self.projects.insert(dst_idx, project)
        self.selected_index = dst_idx
        self.populate_tree(selected_index=self.selected_index)
        self.drag_index = None

    # ---------- Images ----------
    def load_thumbnail(self, project):
        try:
            path = os.path.join(THUMBNAILS_DIR, project["thumbnail"])
            img = Image.open(path)
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
            path = os.path.join(GALLERY_DIR, rel)
            try:
                img = Image.open(path)
                img.thumbnail(GALLERY_SIZE)
                tk_img = ImageTk.PhotoImage(img)
                self.gallery_images.append(tk_img)

                lbl = tk.Label(self.gallery_frame, image=tk_img)
                lbl.pack(side="left", padx=4)
                lbl.bind("<Button-1>", lambda e, i=idx: self.remove_gallery_image(i))
            except Exception:
                pass

    def remove_gallery_image(self, index):
        project = self.projects[self.selected_index]
        project["gallery"].pop(index)
        self.load_gallery(project)

    # ---------- Pickers ----------
    def pick_thumbnail(self):
        self.new_thumbnail = filedialog.askopenfilename(
            filetypes=[("Images", "*.png *.jpg *.jpeg")]
        )

    def pick_gallery(self):
        self.new_gallery = filedialog.askopenfilenames(
            filetypes=[("Images", "*.png *.jpg *.jpeg")]
        )

    # ---------- Save Project Changes ----------
    def save_changes(self):
        if self.selected_index is None:
            messagebox.showwarning("No Project Selected", "Please select a project to save.")
            return
        project = self.projects[self.selected_index]

        for key, entry in self.fields.items():
            val = entry.get().strip()
            if val:
                project[key] = val
            elif key in project:
                del project[key]

        project["category"] = self.category_var.get()

        if self.new_thumbnail:
            ext = os.path.splitext(self.new_thumbnail)[1]
            dest = os.path.join(
                THUMBNAILS_DIR, project["category"], f'{project["id"]}{ext}'
            )
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(self.new_thumbnail, dest)
            project["thumbnail"] = f'{project["category"]}/{project["id"]}{ext}'
            self.new_thumbnail = None

        if self.new_gallery and project["category"] == "colour-grading":
            gdir = os.path.join(GALLERY_DIR, project["id"])
            os.makedirs(gdir, exist_ok=True)
            gallery = []
            for i, img in enumerate(self.new_gallery, 1):
                ext = os.path.splitext(img)[1]
                name = f'{project["id"]}-{i}{ext}'
                shutil.copy2(img, os.path.join(gdir, name))
                gallery.append(f'{project["id"]}/{name}')
            project["gallery"] = gallery
            self.new_gallery = None

        self.data["projects"] = self.projects
        self.populate_tree(selected_index=self.selected_index)
        self.load_project_into_fields()

    # ---------- Create New Project ----------
    def create_new_project(self):
        title = simpledialog.askstring("New Project", "Enter new project title:")
        if not title:
            return

        # Generate slug/id
        new_id = re.sub(r'[^a-z0-9\-]', '', title.lower().replace(' ', '-'))
        existing_ids = {p["id"] for p in self.projects}
        counter = 1
        unique_id = new_id
        while unique_id in existing_ids:
            unique_id = f"{new_id}-{counter}"
            counter += 1
        new_id = unique_id

        new_project = {
            "id": new_id,
            "title": title,
            "category": self.categories[0] if self.categories else "",
            "vimeoId": "",
            "thumbnail": "",
            "client": "",
            "description": "",
            "role": "",
            "year": "",
        }

        self.projects.append(new_project)
        self.data["projects"] = self.projects
        self.selected_index = len(self.projects) - 1
        self.populate_tree(selected_index=self.selected_index)
        self.load_project_into_fields()

    # ---------- Delete Project ----------
    def delete_project(self):
        if self.selected_index is None:
            messagebox.showwarning("No Project Selected", "Please select a project to delete.")
            return

        project = self.projects[self.selected_index]
        confirm = messagebox.askyesno("Delete Project", f"Are you sure you want to delete '{project['title']}'?")
        if not confirm:
            return

        self.projects.pop(self.selected_index)
        self.data["projects"] = self.projects

        if self.projects:
            self.selected_index = min(self.selected_index, len(self.projects) - 1)
        else:
            self.selected_index = None

        self.populate_tree(selected_index=self.selected_index)
        self.load_project_into_fields()

    # ---------- Save All Changes ----------
    def save_all_changes(self):
        save_data(self.data)
        messagebox.showinfo("Saved", "All changes have been saved to projects.json")


# =====================
# RUN
# =====================
if __name__ == "__main__":
    PortfolioApp().mainloop()