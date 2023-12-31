use std::{net::UdpSocket, time::SystemTime};

use bevy::prelude::*;
use bevy::utils::Duration;
use bevy_renet::{
    renet::{
        transport::{NetcodeServerTransport, ServerAuthentication, ServerConfig},
        ConnectionConfig, DefaultChannel, RenetServer, ServerEvent,
    },
    transport::NetcodeServerPlugin,
    RenetServerPlugin,
};

#[derive(Resource)]
struct SimulationTickerConfig {
    timer: Timer,
}

fn main() {
    let mut app = App::new();
    app.add_plugins(MinimalPlugins);
    app.add_plugins(RenetServerPlugin);
    let server = RenetServer::new(ConnectionConfig::default());
    app.insert_resource(server);
    app.add_plugins(NetcodeServerPlugin);
    let server_addr = "127.0.0.1:5000".parse().unwrap();
    let socket = UdpSocket::bind(server_addr).unwrap();
    const MAX_CLIENTS: usize = 64;
    const GAME_PROTOCOL_ID: u64 = 0;
    let server_config = ServerConfig {
        max_clients: MAX_CLIENTS,
        protocol_id: GAME_PROTOCOL_ID,
        public_addr: server_addr,
        authentication: ServerAuthentication::Unsecure,
    };
    let current_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let transport = NetcodeServerTransport::new(current_time, server_config, socket).unwrap();
    app.insert_resource(transport);
    let simulation_ticket_config = SimulationTickerConfig {
        timer: Timer::new(Duration::from_millis(500), TimerMode::Repeating)
    };
    app.insert_resource(simulation_ticket_config);
    // app.add_systems(Update, (send_message_system, receive_message_system, handle_events_system));
    app.add_systems(Update, (tick_system, handle_events_system));
    app.run();
}

fn tick_system(mut server: ResMut<RenetServer>, time: Res<Time>, mut simulation_ticker_config: ResMut<SimulationTickerConfig>) {
    simulation_ticker_config.timer.tick(time.delta());
    if simulation_ticker_config.timer.finished() {
        server.broadcast_message(DefaultChannel::ReliableOrdered, "tick".as_bytes().to_vec());
        simulation_ticker_config.timer.reset();
    }
}


fn send_message_system(mut server: ResMut<RenetServer>) {
    let channel_id = 0;
    // Send a text message for all clients
    // The enum DefaultChannel describe the channels used by the default configuration
    server.broadcast_message(
        DefaultChannel::ReliableOrdered,
        "server message".as_bytes().to_vec(),
    );
}

fn receive_message_system(mut server: ResMut<RenetServer>) {
    // Send a text message for all clients
    for client_id in server.clients_id().into_iter() {
        while let Some(message) = server.receive_message(client_id, DefaultChannel::ReliableOrdered)
        {
            // Handle received message
        }
    }
}

fn handle_events_system(
    mut server: ResMut<RenetServer>,
    mut server_events: EventReader<ServerEvent>,
) {
    while let Some(event) = server.get_event() {
        for event in server_events.iter() {
            match event {
                ServerEvent::ClientConnected { client_id } => {
                    println!("Client {client_id} connected");
                }
                ServerEvent::ClientDisconnected { client_id, reason } => {
                    println!("Client {client_id} disconnected: {reason}");
                }
            }
        }
    }
}
