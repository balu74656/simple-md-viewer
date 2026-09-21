// Skryje konzolove okno v release buildu na Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    md_viewer_lib::run()
}
