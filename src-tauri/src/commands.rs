use std::process::Command;

use tauri::async_runtime;

#[tauri::command]
pub async fn generate_musicgen(
    prompt: String,
    duration: f32,
    model_name: String,
    temperature: f32,
) -> Result<String, String> {
    let code = format!(
        "import core.musicgen_backend as m; \
         print(m.generate_music({prompt:?}, {duration}, {model_name:?}, {temperature}, 'out'))",
        prompt = prompt,
        duration = duration,
        model_name = model_name,
        temperature = temperature,
    );

    let output = async_runtime::spawn_blocking(move || {
        Command::new("python")
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(["-c", &code])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(path)
}
